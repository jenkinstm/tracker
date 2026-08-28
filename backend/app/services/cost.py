"""Расчёт стоимости операций.

Формула сразу в общем виде с суммой по ПС, хотя в MVP слагаемое одно: когда придёт Google,
менять калькулятор не придётся. Все суммы — целые копейки.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass

from app.config import settings

# Сколько результатов отдаёт один запрос к ПС.
RESULTS_PER_REQUEST = {"yandex": 100, "google": 10}


def requests_per_check(engine: str, depth: int) -> int:
    """Запросов к API на одну проверку позиции.

    Для Яндекса при глубине 100 вырождается в единицу: сотня приходит одним запросом.
    """
    per_request = RESULTS_PER_REQUEST.get(engine, 10)
    return max(1, math.ceil(depth / per_request))


@dataclass(frozen=True)
class CostEstimate:
    """Оценка, которую показываем пользователю до запуска и пишем в лог по факту."""

    keywords: int
    requests: int
    mode: str
    cost_kopecks: int

    @property
    def cost_rubles(self) -> float:
        return round(self.cost_kopecks / 100, 2)

    def as_dict(self) -> dict:
        return {**asdict(self), "cost_rubles": self.cost_rubles}


def estimate_positions(
    keywords: int,
    *,
    engine: str = "yandex",
    depth: int = 100,
    mode: str = "deferred",
    price_per_1000_kopecks: int | None = None,
) -> CostEstimate:
    per_check = requests_per_check(engine, depth)
    requests = keywords * per_check
    price = (
        price_per_1000_kopecks
        if price_per_1000_kopecks is not None
        else (
            settings.yandex_search_sync_price_per_1000_kopecks
            if mode == "sync"
            else settings.yandex_search_price_per_1000_kopecks
        )
    )
    cost = round(requests * price / 1000)
    return CostEstimate(keywords=keywords, requests=requests, mode=mode, cost_kopecks=cost)


def estimate_wordstat(
    keywords: int, *, price_per_1000_kopecks: int | None = None
) -> CostEstimate:
    """Частотность всегда синхронна: у Вордстата отложенного режима нет."""
    price = (
        price_per_1000_kopecks
        if price_per_1000_kopecks is not None
        else settings.yandex_wordstat_price_per_1000_kopecks
    )
    cost = round(keywords * price / 1000)
    return CostEstimate(keywords=keywords, requests=keywords, mode="sync", cost_kopecks=cost)


def choose_mode(keywords: int, trigger: str) -> str:
    """Режим выбирается автоматически, а не пользователем.

    Расписание — всегда отложенный режим. Ручной съём — синхронный только до порога,
    потому что за порогом разница в цене шестнадцатикратная.
    """
    if trigger != "manual":
        return "deferred"
    if settings.yandex_search_api_mode == "deferred":
        return "deferred"
    return "sync" if keywords <= settings.sync_max_keywords else "deferred"


def sync_allowed(keywords: int) -> bool:
    """Проверка порога живёт в сервисе, а не в интерфейсе: это защита от перерасхода."""
    return keywords <= settings.sync_max_keywords
