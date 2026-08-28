"""Импорт семантики: дедупликация, шапка, кодировки, разделители."""

from app.services.importer import parse_csv, parse_text, parse_upload
from app.services.text import normalize_phrase


def test_normalize_collapses_spaces_and_case():
    assert normalize_phrase("  Купить   ОКНА ") == "купить окна"


def test_normalize_treats_yo_as_ye():
    assert normalize_phrase("тёплые окна") == normalize_phrase("теплые окна")


def test_normalize_handles_non_breaking_space():
    assert normalize_phrase("купить окна") == "купить окна"


def test_text_import_counts_duplicates_and_empty():
    parsed = parse_text("купить окна\nКУПИТЬ  ОКНА\n\n   \nокна пвх")
    assert [p[1] for p in parsed.phrases] == ["купить окна", "окна пвх"]
    assert parsed.duplicates_in_file == 1
    assert parsed.empty == 2
    assert parsed.total_lines == 5


def test_text_import_drops_too_long_phrases():
    parsed = parse_text("окна\n" + "а" * 500)
    assert parsed.too_long == 1
    assert len(parsed.phrases) == 1


def test_csv_header_is_not_imported_as_a_phrase():
    data = "Фраза;Частотность\nокна пвх;100\n".encode()
    parsed = parse_csv(data)
    assert [p[1] for p in parsed.phrases] == ["окна пвх"]


def test_csv_without_header_keeps_first_row():
    parsed = parse_csv("окна пвх;100\nбалкон;50\n".encode())
    assert len(parsed.phrases) == 2


def test_csv_in_cp1251_is_decoded():
    parsed = parse_csv("окна пвх;100\n".encode("cp1251"))
    assert parsed.phrases[0][1] == "окна пвх"


def test_csv_with_comma_delimiter():
    parsed = parse_csv("окна пвх,100\nбалкон,50\n".encode())
    assert [p[1] for p in parsed.phrases] == ["окна пвх", "балкон"]


def test_unknown_extension_is_rejected():
    try:
        parse_upload("semantics.docx", b"x")
    except ValueError as exc:
        assert "CSV" in str(exc)
    else:
        raise AssertionError("Должно было упасть")


def test_large_file_deduplicates():
    lines = "\n".join(["купить окна"] * 5000)
    parsed = parse_text(lines)
    assert len(parsed.phrases) == 1
    assert parsed.duplicates_in_file == 4999
