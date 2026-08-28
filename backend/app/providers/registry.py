"""Выбор провайдера по настройкам. Сервисы знают про протокол, а не про реализацию."""

from __future__ import annotations

from app.config import settings
from app.providers.base import SerpProvider, WordstatProvider
from app.providers.mock import MockProvider
from app.providers.yandex_search_api import YandexSearchApiProvider


def get_serp_provider(name: str | None = None, *, own_domain: str = "example.com") -> SerpProvider:
    provider = (name or settings.serp_provider).lower()
    if provider in ("yandex", "yandex_search_api"):
        return YandexSearchApiProvider()
    if provider == "mock":
        return MockProvider(own_domain=own_domain)
    raise ValueError(f"Неизвестный провайдер позиций: {provider}")


def get_wordstat_provider(name: str | None = None) -> WordstatProvider:
    provider = (name or settings.wordstat_provider).lower()
    if provider in ("yandex", "yandex_search_api"):
        return YandexSearchApiProvider()
    if provider == "mock":
        return MockProvider()
    raise ValueError(f"Неизвестный провайдер частотности: {provider}")


def provider_price_per_1000(operation: str) -> int:
    """Цена операции в копейках за тысячу. Разные операции — разные ставки."""
    if settings.serp_provider == "mock":
        return 0
    return {
        "serp_deferred": settings.yandex_search_price_per_1000_kopecks,
        "serp_sync": settings.yandex_search_sync_price_per_1000_kopecks,
        "wordstat_top": settings.yandex_wordstat_price_per_1000_kopecks,
    }.get(operation, 0)
