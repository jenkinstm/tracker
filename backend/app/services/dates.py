"""Календарные помощники для Вордстата."""

from __future__ import annotations

import calendar
from datetime import date, timedelta

PERIODS = ("PERIOD_DAILY", "PERIOD_WEEKLY", "PERIOD_MONTHLY")


def normalize_period(period: str) -> str:
    """Вордстат требует префикс PERIOD_. Без него — ошибка, в proto это не описано."""
    value = (period or "monthly").upper()
    if not value.startswith("PERIOD_"):
        value = "PERIOD_" + value
    if value not in PERIODS:
        raise ValueError(f"Неизвестный период Вордстата: {period}")
    return value


def last_day_of_period(day: date, period: str) -> date:
    """Для PERIOD_MONTHLY toDate обязан быть последним днём месяца, для weekly — недели.

    В proto это не описано, узнаётся только из ответа сервера.
    """
    normalized = normalize_period(period)
    if normalized == "PERIOD_MONTHLY":
        return day.replace(day=calendar.monthrange(day.year, day.month)[1])
    if normalized == "PERIOD_WEEKLY":
        return day + timedelta(days=6 - day.weekday())
    return day
