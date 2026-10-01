from types import SimpleNamespace

import httpx
from openai import BadRequestError

from app.config import Settings
from app.llm import Analyzer, clean, parse_json


def test_parse_json_with_surrounding_text():
    assert parse_json('Hier: {"is_first_page": true} fertig') == {"is_first_page": True}


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
