"""Paperless-ngx REST-API Client."""
from __future__ import annotations

import time
from pathlib import Path

import httpx

from .config import Settings


class PaperlessError(RuntimeError):
    pass


class Paperless:
    def __init__(self, settings: Settings):
        self.s = settings
        self._cache: list[dict] | None = None
        self._cache_time = 0.0
        self._error: tuple[str, float] | None = None

    def _client(self) -> httpx.Client:
        if not self.s.paperless_configured:
            raise PaperlessError("Paperless ist nicht konfiguriert (PAPERLESS_URL / PAPERLESS_TOKEN in .env)")
        headers = {"Authorization": f"Token {self.s.paperless_token}", "Accept": "application/json; version=5"}
        if self.s.cf_access_client_id:
            headers["CF-Access-Client-Id"] = self.s.cf_access_client_id
            headers["CF-Access-Client-Secret"] = self.s.cf_access_client_secret
        return httpx.Client(base_url=self.s.paperless_url, headers=headers, timeout=60, follow_redirects=False)

    @staticmethod
    def _check(resp: httpx.Response) -> httpx.Response:
        if resp.is_redirect:
            raise PaperlessError(
                f"Weiterleitung nach {resp.headers.get('location')} – vermutlich Cloudflare Access oder falsche URL"
            )
        if resp.status_code >= 400:
            raise PaperlessError(f"Paperless antwortet {resp.status_code}: {resp.text[:300]}")
        return resp

    # --- Korrespondenten -------------------------------------------------
    def correspondents(self, refresh: bool = False) -> list[dict]:
        if self._cache is not None and not refresh and time.time() - self._cache_time < 300:
            return self._cache
        # Nicht bei jedem Polling-Request erneut in einen Timeout laufen
        if self._error and not refresh and time.time() - self._error[1] < 30:
            raise PaperlessError(self._error[0])
        try:
            result = self._fetch_correspondents()
        except Exception as e:
            self._error = (str(e) or type(e).__name__, time.time())
            raise PaperlessError(self._error[0]) from e
        self._error = None
        self._cache, self._cache_time = result, time.time()
        return result

    def _fetch_correspondents(self) -> list[dict]:
        result: list[dict] = []
        with self._client() as c:
            url: str | None = "/api/correspondents/?page_size=100&ordering=name"
            while url:
                data = self._check(c.get(url)).json()
                result += [{"id": r["id"], "name": r["name"], "document_count": r.get("document_count")}
                           for r in data["results"]]
                url = data.get("next")
                if url and url.startswith(self.s.paperless_url):
                    url = url[len(self.s.paperless_url):]
                elif url and url.startswith("http"):
                    # Paperless hinter Proxy liefert evtl. interne URL – Pfad übernehmen
                    url = "/" + url.split("/", 3)[3]
        return result

    def create_correspondent(self, name: str) -> dict:
        with self._client() as c:
            r = self._check(c.post("/api/correspondents/", json={"name": name.strip()})).json()
        entry = {"id": r["id"], "name": r["name"], "document_count": 0}
        if self._cache is not None:
            self._cache.append(entry)
            self._cache.sort(key=lambda x: x["name"].lower())
        return entry

    # --- Dokumente ---------------------------------------------------------
    def upload(self, pdf: Path, title: str | None, correspondent: int | None, created: str | None) -> str:
        data: dict[str, str] = {}
        if title:
            data["title"] = title
        if correspondent:
            data["correspondent"] = str(correspondent)
        if created:
            data["created"] = created
        with self._client() as c, pdf.open("rb") as fh:
            resp = self._check(c.post("/api/documents/post_document/", data=data,
                                      files={"document": (pdf.name, fh, "application/pdf")}))
        return resp.json()  # Task-UUID als String

    def task(self, task_id: str) -> dict | None:
        with self._client() as c:
            data = self._check(c.get("/api/tasks/", params={"task_id": task_id})).json()
        if isinstance(data, dict):
            data = data.get("results", [])
        return data[0] if data else None
