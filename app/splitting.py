"""Reine Logik: Trennvorschläge aus Seitenanalysen und Dokumente aus Trennstellen ableiten."""
from __future__ import annotations

import re

from rapidfuzz import fuzz

from .matching import normalize

UNCERTAIN_BELOW = 0.7

_MARKER_RE = re.compile(r"(?:seite|page|blatt|s\.)?\s*(\d+)\s*(?:von|/|of|v\.)\s*(\d+)", re.I)
_SINGLE_RE = re.compile(r"(?:seite|page|blatt)\s*(\d+)", re.I)


def marker_page_number(marker: str | None) -> int | None:
    if not marker:
        return None
    m = _MARKER_RE.search(marker) or _SINGLE_RE.search(marker)
    return int(m.group(1)) if m else None


def same_supplier(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return True  # unbekannt => kein Grund zu trennen
    na, nb = normalize(a), normalize(b)
    return na == nb or fuzz.token_set_ratio(na, nb) >= 85


def is_start_candidate(index: int, duplex: bool) -> bool:
    # Beim Duplex-Scan beginnt jedes Blatt auf einer Vorderseite (gerader Index, 0-basiert).
    return not duplex or index % 2 == 0


def propose_splits(pages: list[dict], duplex: bool) -> list[int]:
    """Liefert die Seitenindizes (>0), an denen ein neues Dokument beginnt."""
    starts: list[int] = []
    prev_supplier: str | None = None
    for i, p in enumerate(pages):
        a = p.get("analysis")
        if p.get("blank") or not a:
            continue
        if i > 0 and is_start_candidate(i, duplex):
            new = a.get("is_first_page", False)
            number = marker_page_number(a.get("page_marker"))
            if number == 1:
                new = True
            elif number and number > 1:
                new = False
            elif not same_supplier(a.get("supplier"), prev_supplier):
                new = True
            if new:
                starts.append(i)
        if a.get("supplier"):
            prev_supplier = a["supplier"]
    return starts


def segments(page_total: int, splits: list[int]) -> list[tuple[int, int]]:
    """(start, end_exklusiv) je Dokument."""
    starts = [0] + sorted(s for s in set(splits) if 0 < s < page_total)
    return [(s, starts[i + 1] if i + 1 < len(starts) else page_total) for i, s in enumerate(starts)]


def is_uncertain(page: dict) -> bool:
    a = page.get("analysis")
    return bool(a) and not page.get("blank") and a.get("confidence", 1.0) < UNCERTAIN_BELOW
