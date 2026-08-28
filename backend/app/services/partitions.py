"""Помесячные партиции для positions и serp_snapshots.

Партиция создаётся заранее, а не в момент вставки: промах по партиции — это отказ вставки,
а не медленный запрос.
"""

from __future__ import annotations

from datetime import date

PARTITIONED_TABLES = ("positions", "serp_snapshots")


def month_bounds(day: date) -> tuple[date, date]:
    start = day.replace(day=1)
    end = date(start.year + 1, 1, 1) if start.month == 12 else date(start.year, start.month + 1, 1)
    return start, end


def partition_name(table: str, day: date) -> str:
    return f"{table}_p{day.year:04d}{day.month:02d}"


def create_partition_sql(table: str, day: date) -> str:
    start, end = month_bounds(day)
    name = partition_name(table, day)
    return (
        f"CREATE TABLE IF NOT EXISTS {name} PARTITION OF {table} "
        f"FOR VALUES FROM ('{start.isoformat()}') TO ('{end.isoformat()}')"
    )


def months_around(day: date, back: int = 1, ahead: int = 2) -> list[date]:
    """Список первых чисел месяцев вокруг даты — для предсоздания партиций."""
    months: list[date] = []
    base = day.replace(day=1)
    for offset in range(-back, ahead + 1):
        total = base.year * 12 + (base.month - 1) + offset
        months.append(date(total // 12, total % 12 + 1, 1))
    return months
