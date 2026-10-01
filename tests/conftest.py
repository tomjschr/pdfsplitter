from pathlib import Path

import pymupdf
import pytest


def make_pdf(path: Path, pages: list[str | None]) -> Path:
    """Erzeugt ein Test-PDF; None = leere Seite."""
    doc = pymupdf.open()
    for text in pages:
        page = doc.new_page(width=595, height=842)
        if text:
            page.insert_textbox(pymupdf.Rect(60, 60, 540, 780), text, fontsize=14)
            page.draw_rect(pymupdf.Rect(60, 400, 540, 600), color=(0, 0, 0), fill=(0.2, 0.2, 0.2))
    doc.save(path)
    return path


@pytest.fixture
def sample_pdf(tmp_path):
    return make_pdf(tmp_path / "scan.pdf", [
        "Telekom Deutschland GmbH\nRechnung\nSeite 1 von 2", None,
        "Telekom\nSeite 2 von 2", None,
        "Stadtwerke Musterstadt\nJahresabrechnung", None,
    ])
