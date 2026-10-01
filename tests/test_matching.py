from app.matching import match, normalize

CORR = [
    {"id": 1, "name": "Telekom Deutschland GmbH"},
    {"id": 2, "name": "Stadtwerke Musterstadt"},
    {"id": 3, "name": "Allianz Versicherungs-AG"},
]


def test_normalize_strips_legal_forms_and_umlauts():
    assert normalize("Müller & Söhne GmbH & Co. KG") == "mueller soehne"
    assert normalize("Telekom Deutschland GmbH") == "telekom"


def test_exact_after_normalization():
    m = match("Telekom", CORR)
    assert m["status"] == "exact" and m["best"]["id"] == 1


def test_similar_name():
    m = match("Allianz Versicherung", CORR)
    assert m["status"] == "similar" and m["best"]["id"] == 3


def test_unknown_is_new():
    assert match("Finanzamt Hamburg", CORR)["status"] == "new"


def test_empty_name():
    assert match(None, CORR)["status"] == "none"
    assert match("  ", CORR)["status"] == "none"
