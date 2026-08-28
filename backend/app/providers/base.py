"""Общие протоколы провайдеров.

Провайдер в MVP один, но протокол обязателен: на вехе M9 добавится Google, и он должен
встать рядом без правок в сервисах.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable


class ProviderError(RuntimeError):
    """Ошибка провайдера, которую имеет смысл ретраить."""

    def __init__(self, message: str, *, code: str = "provider_error") -> None:
        super().__init__(message)
        self.code = code


class QuotaExceededError(ProviderError):
    """Квота или бюджет исчерпаны. Ретраить бессмысленно — вернётся то же самое."""

    def __init__(self, message: str = "Квота провайдера исчерпана") -> None:
        super().__init__(message, code="quota_exceeded")


class OperationExpiredError(ProviderError):
    """Отложенный результат удалён. Деньги списаны, данных нет."""

    def __init__(self, message: str = "Отложенная операция просрочена") -> None:
        super().__init__(message, code="operation_expired")


@dataclass(frozen=True)
class SerpItem:
    pos: int
    url: str
    domain: str
    title: str = ""

    def as_dict(self) -> dict:
        return {"pos": self.pos, "url": self.url, "domain": self.domain, "title": self.title}


@dataclass(frozen=True)
class WordstatResult:
    """Ответ topRequests. freq_exact недоступен через Search API: операторов там нет."""

    phrase: str
    total_count: int
    results: list[dict] = field(default_factory=list)
    associations: list[dict] = field(default_factory=list)


@runtime_checkable
class SerpProvider(Protocol):
    name: str
    supports_deferred: bool

    def search(
        self, query: str, *, region: str, depth: int = 100, fix_typos: bool = True
    ) -> list[dict]:
        """Синхронный поиск. Дорогой режим, только для ручных прогонов до порога."""

    def submit_deferred(
        self, query: str, *, region: str, depth: int = 100, fix_typos: bool = True
    ) -> str:
        """Поставить отложенный запрос, вернуть operation_id."""

    def fetch_deferred(self, operation_id: str) -> list[dict] | None:
        """Забрать результат. None — ещё не готов."""


@runtime_checkable
class WordstatProvider(Protocol):
    name: str

    def top_requests(
        self, phrase: str, *, region: str | None = None, num_phrases: int = 1
    ) -> WordstatResult:
        """Частотность фразы и, при большом num_phrases, похожие фразы с ассоциациями."""

    def regions_tree(self) -> list[dict]:
        """Справочник регионов. Единственный бесплатный метод Вордстата."""
