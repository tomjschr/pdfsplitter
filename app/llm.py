"""Seitenanalyse über einen OpenAI-kompatiblen Vision-Endpoint (Ollama, OpenRouter oder OpenAI)."""
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
gleicher Absender wie die Vorseite.

Antworte NUR mit JSON in genau diesem Format:
{"is_first_page": true|false,
 "confidence": 0.0-1.0,
 "supplier": "Name des Absenders/Lieferanten/Ausstellers oder null",
 "date": "YYYY-MM-DD (Dokumentdatum) oder null",
 "title": "kurzer deutscher Titel, z. B. 'Rechnung 2023-0815' oder 'Kündigungsbestätigung', oder null",
 "page_marker": "z. B. 'Seite 2 von 3' oder null"}

"supplier" ist immer der ABSENDER des Dokuments, nie der Empfänger."""


def _user_prompt(prev: dict | None, text: str, known: list[str]) -> str:
    parts = []
    if prev:
        parts.append(
            "Vorherige Seite: "
            f"Absender={prev.get('supplier')!r}, Titel={prev.get('title')!r}, Seitenangabe={prev.get('page_marker')!r}."
        )
    else:
        parts.append("Dies ist die erste Seite des Stapels (also sicher eine erste Seite).")
    if known:
        parts.append(
            "Bereits bekannte Absender – wenn einer davon passt, verwende exakt diese Schreibweise: "
            + "; ".join(known)
        )
    if text:
        parts.append("Text der Seite (OCR, evtl. fehlerhaft):\n" + text[:3000])
    parts.append("Analysiere die Seite im Bild.")
    return "\n\n".join(parts)


def parse_json(content: str) -> dict:
    content = content.strip()
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


class Analyzer:
    def __init__(self, settings: Settings):
        self.s = settings
        self.client = OpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key or "none", timeout=180)

    json_mode = True  # wird abgeschaltet, falls Modell/Anbieter den JSON-Modus ablehnt

    def analyze_page(self, image_jpeg: bytes, text: str, prev: dict | None, known: list[str]) -> dict:
        b64 = base64.b64encode(image_jpeg).decode()
        kwargs = dict(
            model=self.s.llm_model,
            temperature=0,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": [
                    {"type": "text", "text": _user_prompt(prev, text, known)},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                ]},
            ],
        )
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
