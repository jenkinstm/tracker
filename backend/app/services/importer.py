"""Импорт семантики из текста и файлов.

Дубли схлопываются по phrase_normalized внутри проекта, лишние пробелы чистятся,
регистр приводится к нижнему. Пользователю показываем, что именно отброшено и почему.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass

from app.services.text import normalize_phrase

MAX_PHRASE_LENGTH = 400

# Выгрузки из Вордстата, Кейсо и Топвизора приходят с шапкой. Без её отсечения
# «Фраза» уезжает в проект как ключевое слово и потом стоит денег на каждом съёме.
HEADER_WORDS = {
    "фраза",
    "фразы",
    "запрос",
    "запросы",
    "ключевое слово",
    "ключевые слова",
    "ключевик",
    "поисковый запрос",
    "keyword",
    "keywords",
    "phrase",
    "query",
}


def _drop_header(lines: list[str]) -> list[str]:
    if lines and normalize_phrase(lines[0]) in HEADER_WORDS:
        return lines[1:]
    return lines


@dataclass
class ParsedPhrases:
    phrases: list[tuple[str, str]]  # (исходная фраза, нормализованная)
    total_lines: int
    duplicates_in_file: int
    empty: int
    too_long: int


def parse_text(raw: str) -> ParsedPhrases:
    lines = (raw or "").splitlines()
    return _collect(lines)


def parse_csv(data: bytes) -> ParsedPhrases:
    """Берём первую колонку: в выгрузках из Вордстата и Кейсо фраза всегда первая."""
    text = _decode(data)
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t")
    except csv.Error:
        dialect = csv.excel
        dialect.delimiter = ";" if sample.count(";") > sample.count(",") else ","
    rows = csv.reader(io.StringIO(text), dialect)
    return _collect(_drop_header([row[0] for row in rows if row]))


def parse_xlsx(data: bytes) -> ParsedPhrases:
    from openpyxl import load_workbook

    workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    sheet = workbook.active
    lines: list[str] = []
    for row in sheet.iter_rows(values_only=True):
        if not row:
            continue
        first = row[0]
        lines.append("" if first is None else str(first))
    workbook.close()
    return _collect(_drop_header(lines))


def parse_upload(filename: str, data: bytes) -> ParsedPhrases:
    lower = (filename or "").lower()
    if lower.endswith((".xlsx", ".xlsm")):
        return parse_xlsx(data)
    if lower.endswith((".csv", ".tsv", ".txt")):
        return parse_csv(data)
    raise ValueError("Поддерживаются только CSV, TSV, TXT и XLSX")


def _decode(data: bytes) -> str:
    # Выгрузки из Excel в России до сих пор приходят в cp1251.
    for encoding in ("utf-8-sig", "utf-8", "cp1251"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _collect(lines: list[str]) -> ParsedPhrases:
    seen: set[str] = set()
    phrases: list[tuple[str, str]] = []
    duplicates = empty = too_long = 0
    total = 0

    for line in lines:
        total += 1
        phrase = (line or "").strip()
        normalized = normalize_phrase(phrase)
        if not normalized:
            empty += 1
            continue
        if len(normalized) > MAX_PHRASE_LENGTH:
            too_long += 1
            continue
        if normalized in seen:
            duplicates += 1
            continue
        seen.add(normalized)
        phrases.append((phrase, normalized))

    return ParsedPhrases(
        phrases=phrases,
        total_lines=total,
        duplicates_in_file=duplicates,
        empty=empty,
        too_long=too_long,
    )
