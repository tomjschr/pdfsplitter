import time
from dataclasses import replace

import pymupdf
import pytest
from fastapi.testclient import TestClient

from app import pdf


def test_blank_detection(sample_pdf):
    assert pdf.detect_blank_pages(sample_pdf) == [False, True, False, True, False, True]


def test_build_pdf_with_rotation(sample_pdf, tmp_path):
    out = pdf.build_pdf(sample_pdf, [(0, 0), (2, 90)], tmp_path / "out.pdf")
    with pymupdf.open(out) as doc:
        assert doc.page_count == 2
        assert doc[1].rotation == 90
        assert "Telekom" in doc[1].get_text()


class FakeAnalyzer:
    two_stage = False

    def __init__(self, settings):
        pass

    def analyze_page(self, image, text, prev, known):
        first_line = text.splitlines()[0] if text else None
        marker = next((line for line in text.splitlines() if line.startswith("Seite")), None)
        return {"is_first_page": "Seite 2" not in text, "confidence": 0.95, "supplier": first_line,
                "date": "2024-03-01", "title": "Testdokument", "page_marker": marker}


class FakeTwoStage(FakeAnalyzer):
    """OCR liefert den Text der Seite; Entscheidung prüft, dass Nachbarseiten mitkommen."""
    two_stage = True
    calls: list = []

    def ocr_page(self, image):
        return image.decode()  # render_for_llm ist im Test so gepatcht, dass es den Seitentext liefert

    def analyze_text(self, prev_text, text, next_text, prev, known):
        FakeTwoStage.calls.append((prev_text is not None, next_text is not None))
        return FakeAnalyzer.analyze_page(self, b"", text, prev, known)


@pytest.fixture
def client(tmp_path, monkeypatch):
    import app.config as config
    import app.llm as llm

    s = replace(config.Settings(), data_dir=tmp_path / "data", paperless_url="", paperless_token="",
                llm_base_url="http://fake/v1", consume_dir=str(tmp_path / "consume"))
    (tmp_path / "consume").mkdir()
    monkeypatch.setattr(config, "settings", s)
    monkeypatch.setattr(llm, "Analyzer", FakeAnalyzer)
    import importlib

    import app.main as main
    importlib.reload(main)
    return TestClient(main.app)


def wait_ready(client, job_id):
    for _ in range(100):
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] == "ready":
            return job
        time.sleep(0.05)
    raise AssertionError("Job wurde nicht fertig")


def test_end_to_end(client, sample_pdf, tmp_path):
    with sample_pdf.open("rb") as fh:
        r = client.post("/api/jobs", files={"file": ("scan.pdf", fh, "application/pdf")}, data={"duplex": "true"})
    assert r.status_code == 200, r.text
    job = wait_ready(client, r.json()["id"])

    assert [p["blank"] for p in job["pages"]] == [False, True, False, True, False, True]
    assert job["splits"] == [4]
    docs = job["documents"]
    assert [d["active_pages"] for d in docs] == [[0, 2], [4]]
    assert docs[0]["supplier"].startswith("Telekom")
    assert docs[1]["date"] == "2024-03-01"

    # Manuell trennen + Metadaten ändern
    client.put(f"/api/jobs/{job['id']}/layout", json={"splits": [2, 4]})
    client.put(f"/api/jobs/{job['id']}/documents/2", json={"title": "Eigener Titel"})
    job = client.get(f"/api/jobs/{job['id']}").json()
    assert job["splits_edited"] and len(job["documents"]) == 3
    assert job["documents"][1]["title"] == "Eigener Titel"

    # PDF-Export und Consume-Upload
    r = client.get(f"/api/jobs/{job['id']}/documents/0.pdf")
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    assert client.post(f"/api/jobs/{job['id']}/documents/4/upload?target=consume").status_code == 200
    for _ in range(50):
        if list((tmp_path / "consume").iterdir()):
            break
        time.sleep(0.05)
    files = [f.name for f in (tmp_path / "consume").iterdir()]
    assert files and files[0].startswith("2024-03-01 Stadtwerke Musterstadt Testdokument")

    # Unsichere Seite bestätigen entfernt die Markierung
    import app.main as main

    jid = job["id"]
    assert job["pages"][2]["confirmed"]  # manuell gesetzte Trennung gilt als geprüft
    main.store.jobs[jid].update(lambda s: s["pages"][4]["analysis"].update(confidence=0.4))
    doc = client.get(f"/api/jobs/{jid}").json()["documents"][2]
    assert doc["uncertain"] and doc["uncertain_pages"] == [4]
    client.post(f"/api/jobs/{jid}/confirm", json={"pages": [4]})
    doc = client.get(f"/api/jobs/{jid}").json()["documents"][2]
    assert not doc["uncertain"] and doc["uncertain_pages"] == []

    # Paperless nicht konfiguriert -> sauberer Fehler
    assert client.post(f"/api/jobs/{job['id']}/documents/0/upload?target=paperless").status_code == 400


def test_two_stage(client, sample_pdf, monkeypatch):
    import app.llm as llm

    monkeypatch.setattr(llm, "Analyzer", FakeTwoStage)
    monkeypatch.setattr(pdf, "render_for_llm", lambda path, i: pdf.page_text(path, i).encode())
    FakeTwoStage.calls = []
    with sample_pdf.open("rb") as fh:
        r = client.post("/api/jobs", files={"file": ("scan.pdf", fh, "application/pdf")}, data={"duplex": "true"})
    job = wait_ready(client, r.json()["id"])

    assert job["splits"] == [4]
    assert [d["active_pages"] for d in job["documents"]] == [[0, 2], [4]]
    # 3 sichtbare Seiten: erste ohne Vorgänger, letzte ohne Nachfolger, Leerseiten übersprungen
    assert FakeTwoStage.calls == [(False, True), (True, True), (True, False)]
    assert "ocr_text" not in job["pages"][0] and job["pages"][0]["has_text"]
    t = client.get(f"/api/jobs/{job['id']}/pages/2/text").json()
    assert t["source"] == "ocr" and "Seite 2 von 2" in t["text"]
