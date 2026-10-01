"""PDF-Operationen: Seiten rendern, leere Seiten erkennen, Teil-PDFs bauen."""
from __future__ import annotations

from pathlib import Path

import pymupdf

THUMB_WIDTH = 260
LARGE_WIDTH = 1100
LLM_LONG_SIDE = 1400

# Leerseiten-Erkennung: Anteil "dunkler" Pixel im Innenbereich der Seite.
BLANK_DARK_THRESHOLD = 170  # Grauwert < 170 gilt als Tinte
BLANK_MAX_INK_RATIO = 0.004  # < 0,4 % Tinte => leer
BLANK_MARGIN = 0.06  # Ränder ignorieren (Scannerkanten, Lochungen)


def page_count(pdf_path: Path) -> int:
    with pymupdf.open(pdf_path) as doc:
        return doc.page_count


def render_page(pdf_path: Path, index: int, width: int, out_path: Path, quality: int = 80) -> Path:
    with pymupdf.open(pdf_path) as doc:
        page = doc[index]
        zoom = width / page.rect.width
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), colorspace=pymupdf.csRGB)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        pix.save(out_path, jpg_quality=quality)
    return out_path


def render_for_llm(pdf_path: Path, index: int) -> bytes:
    with pymupdf.open(pdf_path) as doc:
        page = doc[index]
        zoom = LLM_LONG_SIDE / max(page.rect.width, page.rect.height)
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), colorspace=pymupdf.csGRAY)
        return pix.tobytes("jpeg", jpg_quality=85)


def page_text(pdf_path: Path, index: int) -> str:
    """Vorhandene Textebene (z. B. Scanner-OCR); leer bei reinen Bild-Scans."""
    with pymupdf.open(pdf_path) as doc:
        return doc[index].get_text().strip()


def ink_ratio(page: pymupdf.Page) -> float:
    zoom = 40 / 72  # ~40 dpi reicht für die Erkennung
    r = page.rect
    clip = pymupdf.Rect(
        r.x0 + r.width * BLANK_MARGIN,
        r.y0 + r.height * BLANK_MARGIN,
        r.x1 - r.width * BLANK_MARGIN,
        r.y1 - r.height * BLANK_MARGIN,
    )
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), colorspace=pymupdf.csGRAY, clip=clip)
    samples = pix.samples
    if not samples:
        return 0.0
    dark = len(bytes(samples).translate(None, _LIGHT_BYTES))
    return dark / len(samples)


_LIGHT_BYTES = bytes(range(BLANK_DARK_THRESHOLD, 256))


def detect_blank_pages(pdf_path: Path) -> list[bool]:
    with pymupdf.open(pdf_path) as doc:
        return [ink_ratio(page) < BLANK_MAX_INK_RATIO for page in doc]


def build_pdf(pdf_path: Path, pages: list[tuple[int, int]], out_path: Path) -> Path:
    """Erzeugt ein PDF aus (Seitenindex, zusätzliche Drehung in Grad)."""
    with pymupdf.open(pdf_path) as src, pymupdf.open() as dst:
        for index, rotation in pages:
            dst.insert_pdf(src, from_page=index, to_page=index)
            if rotation:
                page = dst[-1]
                page.set_rotation((page.rotation + rotation) % 360)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        dst.save(out_path, garbage=3, deflate=True)
    return out_path
