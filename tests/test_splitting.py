from app.splitting import marker_page_number, propose_splits, segments


def page(first=False, supplier=None, marker=None, blank=False, conf=0.9):
    analysis = None if blank else {"is_first_page": first, "supplier": supplier, "page_marker": marker,
                                   "confidence": conf}
    return {"blank": blank, "analysis": analysis}


def test_marker_parsing():
    assert marker_page_number("Seite 2 von 3") == 2
    assert marker_page_number("1/4") == 1
    assert marker_page_number("Page 3") == 3
    assert marker_page_number(None) is None


def test_duplex_only_front_sides():
    pages = [
        page(True, "A"), page(blank=True),
        page(False, "A", "Seite 2 von 2"), page(True, "B"),  # Rückseite wird ignoriert
        page(True, "C"), page(blank=True),
    ]
    assert propose_splits(pages, duplex=True) == [4]


def test_simplex_supplier_change_splits():
    pages = [page(True, "Telekom"), page(False, "Telekom Deutschland GmbH"), page(False, "Stadtwerke")]
    assert propose_splits(pages, duplex=False) == [2]


def test_marker_overrides_first_page_flag():
    pages = [page(True, "A"), page(True, "A", "Seite 2 von 3")]
    assert propose_splits(pages, duplex=False) == []


def test_segments():
    assert segments(6, [4, 2, 2, 9]) == [(0, 2), (2, 4), (4, 6)]
    assert segments(3, []) == [(0, 3)]
