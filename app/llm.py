"""Seitenanalyse über OpenAI-kompatible Endpoints (Ollama, OpenRouter oder OpenAI).

Zwei Betriebsarten:
- einstufig: ein Vision-Modell sieht das Seitenbild und entscheidet direkt
- zweistufig (OCR_MODEL gesetzt): ein OCR-Modell (z. B. GLM-OCR) liest zuerst alle Seiten als Text,
  danach entscheidet ein Sprachmodell anhand des Texts der vorherigen, aktuellen und nächsten Seite
"""
from __future__ import annotations

import base64
import json
import re

from openai import BadRequestError, OpenAI

from .config import Settings

SYSTEM_PROMPT = """Du analysierst einzelne Seiten aus einem Stapel gescannter Dokumente (Rechnungen, Briefe,
Verträge, Kontoauszüge, Bescheide …). Mehrere Dokumente wurden hintereinander gescannt. Deine Aufgabe:
erkennen, ob die aktuelle Seite die ERSTE Seite eines neuen Dokuments ist, und Metadaten auslesen.

Hinweise für eine erste Seite: Briefkopf/Logo, Anschriftenfeld, Betreff, Datum, "Seite 1 von N".
Hinweise für eine Folgeseite: "Seite 2", fortlaufender Text ohne Briefkopf, Überträge, AGB-Rückseiten,
gleicher Absender wie die Vorseite, ein Satz oder eine Tabelle, die auf der Vorseite begonnen hat.

Antworte NUR mit JSON in genau diesem Format:
{"is_first_page": true|false,
 "confidence": 0.0-1.0,
 "supplier": "Name des Absenders/Lieferanten/Ausstellers oder null",
 "date": "YYYY-MM-DD (Dokumentdatum) oder null",
 "title": "kurzer deutscher Titel, z. B. 'Rechnung 2023-0815' oder 'Kündigungsbestätigung', oder null",
 "page_marker": "z. B. 'Seite 2 von 3' oder null"}

"supplier" ist immer der ABSENDER des Dokuments, nie der Empfänger."""

# GLM-OCR erwartet diesen Aufgaben-Prompt; andere OCR-Modelle kommen damit ebenfalls zurecht
OCR_PROMPT = "Text Recognition:"

PREV_CHARS = 1200  # vom Ende der Vorseite
CURRENT_CHARS = 4000
NEXT_CHARS = 1200  # vom Anfang der Folgeseite


def _known_part(known: list[str]) -> str | None:
    if not known:
        return None
    return "Bereits bekannte Absender – wenn einer davon passt, verwende exakt diese Schreibweise: " + "; ".join(known)


def _prev_part(prev: dict | None) -> str:
    if not prev:
        return "Dies ist die erste Seite des Stapels (also sicher eine erste Seite)."
    return ("Ergebnis der vorherigen Seite: "
            f"Absender={prev.get('supplier')!r}, Titel={prev.get('title')!r}, Seitenangabe={prev.get('page_marker')!r}.")


def _user_prompt(prev: dict | None, text: str, known: list[str]) -> str:
    parts = [_prev_part(prev), _known_part(known)]
    if text:
        parts.append("Text der Seite (OCR, evtl. fehlerhaft):\n" + text[:3000])
    parts.append("Analysiere die Seite im Bild.")
    return "\n\n".join(p for p in parts if p)


def text_prompt(prev_text: str | None, text: str, next_text: str | None, prev: dict | None, known: list[str]) -> str:
    parts = [_prev_part(prev), _known_part(known)]
    if prev_text:
        parts.append("=== ENDE DER VORHERIGEN SEITE ===\n" + prev_text[-PREV_CHARS:])
    parts.append("=== AKTUELLE SEITE (diese bewerten) ===\n" + (text[:CURRENT_CHARS] or "(kein Text erkannt)"))
    if next_text:
        parts.append("=== ANFANG DER NÄCHSTEN SEITE (nur Kontext) ===\n" + next_text[:NEXT_CHARS])
    parts.append("Bewerte ausschließlich die AKTUELLE SEITE.")
    return "\n\n".join(p for p in parts if p)


_THINK_RE = re.compile(r"<think>.*?</think>", re.S)


def parse_json(content: str) -> dict:
    content = _THINK_RE.sub("", content).strip()  # Denk-Ausgabe von Reasoning-Modellen entfernen
    content = re.sub(r"^```(?:json)?|```$", "", content, flags=re.M).strip()
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", content, re.S)
        if not m:
            raise
        return json.loads(m.group(0))


def clean(result: dict) -> dict:
    def s(v):
        if v is None:
            return None
        v = str(v).strip()
        return None if v.lower() in ("", "null", "none", "unbekannt") else v

    date = s(result.get("date"))
    if date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        date = None
    try:
        conf = float(result.get("confidence", 0.5))
    except (TypeError, ValueError):
        conf = 0.5
    return {
        "is_first_page": bool(result.get("is_first_page")),
        "confidence": max(0.0, min(1.0, conf)),
        "supplier": s(result.get("supplier")),
        "date": date,
        "title": s(result.get("title")),
        "page_marker": s(result.get("page_marker")),
    }


def _image_part(image_jpeg: bytes) -> dict:
    return {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(image_jpeg).decode()}}


class Analyzer:
    json_mode = True  # wird abgeschaltet, falls Modell/Anbieter den JSON-Modus ablehnt

    def __init__(self, settings: Settings):
        self.s = settings
        self.client = OpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key or "none", timeout=180)
        self.ocr_client = (
            OpenAI(base_url=settings.ocr_base_url, api_key=settings.ocr_api_key or "none", timeout=300)
            if settings.ocr_configured else None
        )

    @property
    def two_stage(self) -> bool:
        return self.ocr_client is not None

    # --- Stufe 1: Texterkennung --------------------------------------------
    def ocr_page(self, image_jpeg: bytes) -> str:
        resp = self.ocr_client.chat.completions.create(
            model=self.s.ocr_model,
            temperature=0,
            messages=[{"role": "user", "content": [{"type": "text", "text": OCR_PROMPT}, _image_part(image_jpeg)]}],
        )
        return _THINK_RE.sub("", resp.choices[0].message.content or "").strip()

    # --- Stufe 2: Entscheidung ---------------------------------------------
    def analyze_text(self, prev_text: str | None, text: str, next_text: str | None,
                     prev: dict | None, known: list[str]) -> dict:
        return self._decide([
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text_prompt(prev_text, text, next_text, prev, known)},
        ])

    # --- Einstufig: Vision-Modell sieht das Bild ---------------------------
    def analyze_page(self, image_jpeg: bytes, text: str, prev: dict | None, known: list[str]) -> dict:
        return self._decide([
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": [{"type": "text", "text": _user_prompt(prev, text, known)},
                                         _image_part(image_jpeg)]},
        ])

    def _decide(self, messages: list[dict]) -> dict:
        kwargs = dict(model=self.s.llm_model, temperature=0, messages=messages)
        if self.json_mode:
            try:
                resp = self.client.chat.completions.create(response_format={"type": "json_object"}, **kwargs)
            except BadRequestError:
                # z. B. manche OpenRouter-Modelle – ohne JSON-Modus erneut versuchen
                self.json_mode = False
                resp = self.client.chat.completions.create(**kwargs)
        else:
            resp = self.client.chat.completions.create(**kwargs)
        return clean(parse_json(resp.choices[0].message.content or "{}"))
