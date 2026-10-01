"""Konfiguration aus .env / Umgebungsvariablen."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


@dataclass(frozen=True)
class Settings:
    paperless_url: str = _env("PAPERLESS_URL").rstrip("/")
    paperless_token: str = _env("PAPERLESS_TOKEN")
    cf_access_client_id: str = _env("CF_ACCESS_CLIENT_ID")
    cf_access_client_secret: str = _env("CF_ACCESS_CLIENT_SECRET")
    llm_base_url: str = _env("LLM_BASE_URL")
    llm_api_key: str = _env("LLM_API_KEY", "ollama")
    llm_model: str = _env("LLM_MODEL", "qwen2.5vl:7b")
    # Zweistufig: OCR-Modell liest zuerst den Text (leer = einstufig mit Vision-Modell)
    ocr_model: str = _env("OCR_MODEL")
    ocr_base_url_raw: str = _env("OCR_BASE_URL")
    ocr_api_key_raw: str = _env("OCR_API_KEY")
    consume_dir: str = _env("CONSUME_DIR")
    data_dir: Path = Path(_env("DATA_DIR") or ROOT / "data")

    @property
    def paperless_configured(self) -> bool:
        return bool(self.paperless_url and self.paperless_token)

    @property
    def llm_configured(self) -> bool:
        return bool(self.llm_base_url and self.llm_model)

    @property
    def ocr_base_url(self) -> str:
        return self.ocr_base_url_raw or self.llm_base_url

    @property
    def ocr_api_key(self) -> str:
        return self.ocr_api_key_raw or self.llm_api_key

    @property
    def ocr_configured(self) -> bool:
        return bool(self.ocr_model and self.ocr_base_url)

    @property
    def consume_configured(self) -> bool:
        return bool(self.consume_dir)


settings = Settings()
