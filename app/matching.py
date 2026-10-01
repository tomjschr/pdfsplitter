"""Unscharfer Abgleich erkannter Lieferanten mit Paperless-Korrespondenten."""
from __future__ import annotations

import re
import unicodedata

from rapidfuzz import fuzz, process

SIMILAR_SCORE = 85

LEGAL_FORMS = [
    "gmbh & co. kg", "gmbh & co kg", "gmbh", "mbh", "ag", "kg", "ohg", "gbr", "ug", "e.v.", "ev",
    "e.k.", "ek", "se", "kgaa", "ltd", "inc", "llc", "co", "corp", "s.a.", "sa", "b.v.", "bv",
    "deutschland", "germany",
]
_LEGAL_RE = re.compile(
    r"(?<![\w])(" + "|".join(re.escape(f) for f in sorted(LEGAL_FORMS, key=len, reverse=True)) + r")(?![\w])"
)


def normalize(name: str) -> str:
    s = unicodedata.normalize("NFKC", name).lower()
    s = s.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    s = _LEGAL_RE.sub(" ", s)
    s = re.sub(r"[^\w]+", " ", s)
    return " ".join(s.split())


def match(name: str | None, correspondents: list[dict], limit: int = 5) -> dict:
    """Liefert {"status": exact|similar|new|none, "best": {...}|None, "suggestions": [...]}.

    `correspondents` sind Dicts mit mindestens "id" und "name".
    """
    if not name or not name.strip():
        return {"status": "none", "best": None, "suggestions": []}

    target = normalize(name)
    for c in correspondents:
        if c["name"].strip().lower() == name.strip().lower() or (target and normalize(c["name"]) == target):
            return {"status": "exact", "best": _entry(c, 100), "suggestions": [_entry(c, 100)]}

    if not correspondents or not target:
        return {"status": "new", "best": None, "suggestions": []}

    choices = {c["id"]: normalize(c["name"]) for c in correspondents}
    by_id = {c["id"]: c for c in correspondents}
    results = process.extract(target, choices, scorer=fuzz.token_set_ratio, limit=limit)
    suggestions = [_entry(by_id[cid], round(score)) for _, score, cid in results if score >= 60]
    best = suggestions[0] if suggestions and suggestions[0]["score"] >= SIMILAR_SCORE else None
    return {"status": "similar" if best else "new", "best": best, "suggestions": suggestions}


def _entry(c: dict, score: float) -> dict:
    return {"id": c["id"], "name": c["name"], "score": score}
