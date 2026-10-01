from types import SimpleNamespace

import httpx
from openai import BadRequestError

from app.config import Settings
from app.llm import Analyzer, clean, parse_json


def test_parse_json_with_surrounding_text():
    assert parse_json('Hier: {"is_first_page": true} fertig') == {"is_first_page": True}


def test_parse_json_strips_reasoning_and_fences():
    raw = '<think>Ist das {vielleicht} eine Folgeseite?</think>\n```json\n{"is_first_page": false}\n```'
    assert parse_json(raw) == {"is_first_page": False}


def test_text_prompt_contains_neighbours():
    from app.llm import text_prompt

    p = text_prompt("…Übertrag 1.234,00 €", "Seite 2 von 2", "Stadtwerke Musterstadt", None, ["Telekom"])
    assert "ENDE DER VORHERIGEN SEITE" in p and "ANFANG DER NÄCHSTEN SEITE" in p and "Telekom" in p
    assert "VORHERIGEN" not in text_prompt(None, "x", None, None, [])


def test_clean_normalizes_values():
    r = clean({"is_first_page": 1, "confidence": "2", "supplier": "null", "date": "05.03.2024", "title": " X "})
    assert r == {"is_first_page": True, "confidence": 1.0, "supplier": None, "date": None, "title": "X",
                 "page_marker": None}


def test_falls_back_without_json_mode():
    calls = []

    def create(**kwargs):
        calls.append("response_format" in kwargs)
        if "response_format" in kwargs:
            req = httpx.Request("POST", "http://x")
            raise BadRequestError("json mode not supported", response=httpx.Response(400, request=req), body=None)
        content = '{"is_first_page": true, "confidence": 0.9, "supplier": "Telekom"}'
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])

    a = Analyzer(Settings(llm_base_url="http://x/v1"))
    a.client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    assert a.analyze_page(b"jpg", "", None, [])["supplier"] == "Telekom"
    a.analyze_page(b"jpg", "", None, [])
    assert calls == [True, False, False]  # einmal versucht, danach dauerhaft ohne JSON-Modus
