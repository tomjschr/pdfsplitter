"""Jobs: ein hochgeladener Bulk-Scan mit Seitenzustand, Trennstellen und Dokument-Metadaten."""
from __future__ import annotations

import json
import logging
import re
import shutil
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

from . import matching, pdf, splitting
from .config import Settings
from .paperless import Paperless

log = logging.getLogger("pdfsplitter")

MAX_KNOWN_NAMES = 400


class Job:
    def __init__(self, directory: Path, state: dict):
        self.dir = directory
        self.state = state
        self.lock = threading.RLock()

    @property
    def id(self) -> str:
        return self.state["id"]

    @property
    def pdf_path(self) -> Path:
        return self.dir / "original.pdf"

    def save(self) -> None:
        with self.lock:
            tmp = self.dir / "state.json.tmp"
            tmp.write_text(json.dumps(self.state, ensure_ascii=False, indent=1), encoding="utf-8")
            tmp.replace(self.dir / "state.json")

    def update(self, fn) -> None:
        with self.lock:
            fn(self.state)
            self.save()


def safe_filename(*parts: str | None) -> str:
    name = " ".join(p for p in parts if p).strip() or "Dokument"
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", name)
    return name[:150].rstrip(". ") + ".pdf"


class JobStore:
    def __init__(self, settings: Settings, paperless: Paperless):
        self.s = settings
        self.paperless = paperless
        self.root = settings.data_dir / "jobs"
        self.root.mkdir(parents=True, exist_ok=True)
        self.jobs: dict[str, Job] = {}
        for d in sorted(self.root.iterdir()):
            f = d / "state.json"
            if f.exists():
                job = Job(d, json.loads(f.read_text(encoding="utf-8")))
                if job.state["status"] in ("rendering", "analyzing"):
                    job.state["status"] = "ready"
                    job.state["message"] = "Analyse wurde unterbrochen – über „Neu analysieren“ fortsetzen."
                self.jobs[job.id] = job

    # --- Lebenszyklus ------------------------------------------------------
    def create(self, filename: str, data_path: Path, duplex: bool) -> Job:
        job_id = datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
        d = self.root / job_id
        d.mkdir(parents=True)
        shutil.move(str(data_path), d / "original.pdf")
        n = pdf.page_count(d / "original.pdf")
        state = {
            "id": job_id,
            "filename": filename,
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "duplex": duplex,
            "status": "rendering",
            "message": "",
            "progress": {"done": 0, "total": n},
            "pages": [{"blank": False, "deleted": False, "rotation": 0, "analysis": None, "error": None}
                      for _ in range(n)],
            "splits": [],
            "suggested_splits": [],
            "splits_edited": False,
            "docs": {},
        }
        job = Job(d, state)
        job.save()
        self.jobs[job_id] = job
        threading.Thread(target=self._process, args=(job, True), daemon=True).start()
        return job

    def delete(self, job_id: str) -> None:
        job = self.jobs.pop(job_id)
        shutil.rmtree(job.dir, ignore_errors=True)

    def reanalyze(self, job: Job) -> None:
        if job.state["status"] in ("rendering", "analyzing"):
            return
        job.update(lambda s: s.update(status="analyzing", message=""))
        threading.Thread(target=self._process, args=(job, False), daemon=True).start()

    def _process(self, job: Job, detect_blanks: bool) -> None:
        try:
            if detect_blanks:
                blanks = pdf.detect_blank_pages(job.pdf_path)

                def apply(s):
                    for p, b in zip(s["pages"], blanks):
                        p["blank"] = b
                        p["deleted"] = b
                    s["status"] = "analyzing"
                job.update(apply)
            if self.s.llm_configured:
                self._analyze(job)
            else:
                job.update(lambda s: s.update(message="Keine KI konfiguriert – bitte Trennstellen manuell setzen."))
            self._apply_suggestions(job)
            job.update(lambda s: s.update(status="ready"))
        except Exception as e:  # noqa: BLE001
            log.exception("Job %s fehlgeschlagen", job.id)
            job.update(lambda s: s.update(status="ready", message=f"Fehler bei der Verarbeitung: {e}"))

    def _analyze(self, job: Job) -> None:
        from .llm import Analyzer

        analyzer = Analyzer(self.s)
        try:
            known = [c["name"] for c in self.paperless.correspondents()][:MAX_KNOWN_NAMES]
        except Exception:  # noqa: BLE001 – Analyse geht auch ohne Paperless
            known = []
        pages = job.state["pages"]
        total = len(pages)
        prev = None
        errors = attempted = 0
        for i in range(total):
            page = pages[i]
            if page["blank"]:
                job.update(lambda s: s["progress"].update(done=i + 1))
                continue
            if page["analysis"]:  # schon analysiert (Fortsetzen)
                prev = page["analysis"]
                job.update(lambda s: s["progress"].update(done=i + 1))
                continue
            attempted += 1
            try:
                result = analyzer.analyze_page(
                    pdf.render_for_llm(job.pdf_path, i), pdf.page_text(job.pdf_path, i), prev, known
                )
                err = None
            except Exception as e:  # noqa: BLE001
                log.warning("Analyse Seite %s fehlgeschlagen: %s", i + 1, e)
                result, err = None, str(e)[:300]
                errors += 1
                if errors >= 3 and errors == attempted:
                    job.update(lambda s: s.update(message=f"KI nicht erreichbar: {err}"))
                    return

            def apply(s, result=result, err=err, i=i):
                s["pages"][i]["analysis"] = result
                s["pages"][i]["error"] = err
                s["progress"]["done"] = i + 1
                # Zwischenstand der Vorschläge laufend anzeigen
                s["suggested_splits"] = splitting.propose_splits(s["pages"], s["duplex"])
                if not s["splits_edited"]:
                    s["splits"] = s["suggested_splits"]
            job.update(apply)
            if result:
                prev = result
        if errors:
            job.update(lambda s: s.update(message=f"{errors} Seite(n) konnten nicht analysiert werden."))

    def _apply_suggestions(self, job: Job) -> None:
        def apply(s):
            s["suggested_splits"] = splitting.propose_splits(s["pages"], s["duplex"])
            if not s["splits_edited"]:
                s["splits"] = s["suggested_splits"]
        job.update(apply)

    # --- Bearbeitung -------------------------------------------------------
    def set_layout(self, job: Job, splits: list[int] | None, pages: list[dict] | None) -> None:
        def apply(s):
            if splits is not None:
                s["splits"] = sorted({i for i in splits if 0 < i < len(s["pages"])})
                s["splits_edited"] = True
            if pages is not None:
                for p, new in zip(s["pages"], pages):
                    p["deleted"] = bool(new.get("deleted", p["deleted"]))
                    p["rotation"] = int(new.get("rotation", p["rotation"])) % 360
        job.update(apply)

    def use_suggestions(self, job: Job) -> None:
        job.update(lambda s: s.update(splits=list(s["suggested_splits"]), splits_edited=False))

    def set_doc_meta(self, job: Job, start: int, meta: dict) -> None:
        allowed = {"title", "date", "correspondent_id"}

        def apply(s):
            d = s["docs"].setdefault(str(start), {})
            d.setdefault("edited", {}).update({k: v for k, v in meta.items() if k in allowed})
        job.update(apply)

    # --- Ansicht -----------------------------------------------------------
    def documents(self, job: Job, correspondents: list[dict] | None) -> list[dict]:
        s = job.state
        pages = s["pages"]
        result = []
        for start, end in splitting.segments(len(pages), s["splits"]):
            idx = list(range(start, end))
            active = [i for i in idx if not pages[i]["deleted"]]
            analyses = [pages[i]["analysis"] for i in active if pages[i]["analysis"]]
            first = analyses[0] if analyses else {}

            def pick(key):
                if first.get(key):
                    return first[key]
                return next((a[key] for a in analyses if a.get(key)), None)

            supplier = pick("supplier")
            stored = s["docs"].get(str(start), {})
            edited = stored.get("edited", {})
            m = matching.match(supplier, correspondents or []) if correspondents is not None else None
            default_corr = m["best"]["id"] if m and m["best"] else None
            result.append({
                "start": start,
                "end": end,
                "pages": idx,
                "active_pages": active,
                "supplier": supplier,
                "title": edited.get("title", pick("title")),
                "date": edited.get("date", pick("date")),
                "correspondent_id": edited.get("correspondent_id", default_corr),
                "correspondent_edited": "correspondent_id" in edited,
                "match": m,
                "uncertain": start > 0 and splitting.is_uncertain(pages[start]),
                "upload": stored.get("upload"),
                "changed_since_upload": bool(stored.get("upload"))
                and stored["upload"].get("pages") != self._signature(s, active),
            })
        return result

    @staticmethod
    def _signature(s: dict, active: list[int]) -> list[list[int]]:
        return [[i, s["pages"][i]["rotation"]] for i in active]

    def find_doc(self, job: Job, start: int) -> dict:
        try:
            corr = self.paperless.correspondents() if self.s.paperless_configured else None
        except Exception:  # noqa: BLE001
            corr = None
        for d in self.documents(job, corr):
            if d["start"] == start:
                return d
        raise KeyError(start)

    def export_doc(self, job: Job, doc: dict) -> Path:
        pages = [(i, job.state["pages"][i]["rotation"]) for i in doc["active_pages"]]
        if not pages:
            raise ValueError("Dokument hat keine Seiten")
        return pdf.build_pdf(job.pdf_path, pages, job.dir / "export" / f"doc_{doc['start']:04d}.pdf")

    # --- Upload ------------------------------------------------------------
    def upload(self, job: Job, start: int, target: str) -> None:
        doc = self.find_doc(job, start)
        out = self.export_doc(job, doc)
        if target == "paperless" and not self.s.paperless_configured:
            raise ValueError("Paperless ist nicht konfiguriert")
        if target == "consume" and not self.s.consume_configured:
            raise ValueError("CONSUME_DIR ist nicht konfiguriert")
        corr_name = None
        if doc["correspondent_id"] and self.s.paperless_configured:
            corr_name = next((x["name"] for x in self.paperless.correspondents() if x["id"] == doc["correspondent_id"]),
                             None)
        filename = safe_filename(doc["date"], corr_name or doc["supplier"], doc["title"])
        record = {"status": "uploading", "target": target, "message": "", "task_id": None, "document_id": None,
                  "pages": self._signature(job.state, doc["active_pages"]), "at": datetime.now().isoformat(timespec="seconds")}
        self._set_upload(job, start, record)
        threading.Thread(target=self._do_upload, args=(job, start, doc, out, filename, target), daemon=True).start()

    def _set_upload(self, job: Job, start: int, record: dict) -> None:
        job.update(lambda s: s["docs"].setdefault(str(start), {}).__setitem__("upload", record))

    def _patch_upload(self, job: Job, start: int, **kw) -> None:
        job.update(lambda s: s["docs"][str(start)]["upload"].update(kw))

    def _do_upload(self, job: Job, start: int, doc: dict, out: Path, filename: str, target: str) -> None:
        try:
            if target == "consume":
                dest = Path(self.s.consume_dir) / filename
                n = 1
                while dest.exists():
                    dest = dest.with_name(f"{Path(filename).stem} ({n}).pdf")
                    n += 1
                shutil.copyfile(out, dest)
                self._patch_upload(job, start, status="success", message=f"In Consume-Ordner kopiert: {dest.name}")
                return
            named = out.with_name(filename)
            shutil.copyfile(out, named)
            task_id = self.paperless.upload(named, doc["title"], doc["correspondent_id"], doc["date"])
            self._patch_upload(job, start, status="queued", task_id=task_id, message="Paperless verarbeitet …")
            deadline = time.time() + 600
            while time.time() < deadline:
                time.sleep(3)
                t = self.paperless.task(task_id)
                if not t:
                    continue
                status = t.get("status")
                if status == "SUCCESS":
                    self._patch_upload(job, start, status="success", document_id=t.get("related_document"),
                                       message="In Paperless gespeichert")
                    return
                if status in ("FAILURE", "REVOKED"):
                    msg = str(t.get("result") or "Fehler")
                    dup = "duplicate" in msg.lower() or "duplikat" in msg.lower()
                    self._patch_upload(job, start, status="duplicate" if dup else "failure", message=msg[:300])
                    return
            self._patch_upload(job, start, status="queued", message="Paperless braucht ungewöhnlich lange – bitte dort prüfen")
        except Exception as e:  # noqa: BLE001
            log.exception("Upload fehlgeschlagen")
            self._patch_upload(job, start, status="failure", message=str(e)[:300])
