"""Детерминированная заглушка провайдера для локальной разработки и тестов.

Ключей Яндекса не требует и денег не тратит. Выдача выводится из хеша пары «фраза + дата»,
поэтому позиции меняются день ото дня, но воспроизводимы: один и тот же прогон даёт один
и тот же результат. Нужна, чтобы весь путь съёма проверялся без похода наружу.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, date, datetime

from app.config import settings
from app.providers.base import OperationExpiredError, ProviderError, WordstatResult

_MEMORY: dict[str, str] = {}
_TTL_SECONDS = settings.deferred_result_ttl_hours * 3600


def _key(operation_id: str) -> str:
    return f"rankpulse:mock:op:{operation_id}"


def _redis():
    """Redis нужен, чтобы опрашивальщик в другом процессе видел поставленные операции."""
    try:
        import redis

        client = redis.Redis.from_url(settings.redis_url)
        client.ping()
        return client
    except Exception:  # noqa: BLE001 — в юнит-тестах Redis не поднят, это нормально
        return None

_FILLER_DOMAINS = [
    "wikipedia.org",
    "ozon.ru",
    "wildberries.ru",
    "avito.ru",
    "market.yandex.ru",
    "dzen.ru",
    "vk.com",
    "youtube.com",
    "leroymerlin.ru",
    "petrovich.ru",
]


_ASSOCIATION_TAILS = [
    "цена",
    "купить",
    "отзывы",
    "москва",
    "недорого",
    "2026",
    "с установкой",
    "каталог",
    "фото",
    "рейтинг",
]


def _seed(*parts: str) -> int:
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return int(digest[:12], 16)


class MockProvider:
    """Реализует и SerpProvider, и WordstatProvider."""

    name = "mock"
    supports_deferred = True

    def __init__(self, own_domain: str = "example.com", depth: int = 100) -> None:
        self.own_domain = own_domain
        self.depth = depth

    def _serp(self, query: str, region: str, depth: int, day: date | None = None) -> list[dict]:
        day = day or datetime.now(UTC).date()
        seed = _seed(query, region, day.isoformat())
        # Домен проекта попадает в выдачу в 85% случаев, позиция плавает вокруг центра.
        own_position = None if seed % 100 < 15 else (seed // 100) % depth + 1

        items: list[dict] = []
        for index in range(1, depth + 1):
            if index == own_position:
                host = self.own_domain
                path = f"/catalog/{_seed(query) % 900 + 100}"
            else:
                host = _FILLER_DOMAINS[(seed + index) % len(_FILLER_DOMAINS)]
                path = f"/page/{(seed + index) % 9000 + 1000}"
            items.append(
                {
                    "pos": index,
                    "url": f"https://{host}{path}",
                    "domain": host,
                    "title": f"{query} — {host}",
                }
            )
        return items

    def search(
        self, query: str, *, region: str, depth: int = 100, fix_typos: bool = True
    ) -> list[dict]:
        if not query.strip():
            raise ProviderError("Пустой запрос", code="bad_request")
        return self._serp(query, str(region), depth)

    def submit_deferred(
        self, query: str, *, region: str, depth: int = 100, fix_typos: bool = True
    ) -> str:
        """Параметры запроса кладём в Redis под коротким идентификатором.

        Опрашивальщик живёт в другом процессе, поэтому держать выдачу в памяти воркера,
        поставившего запрос, нельзя — ровно та же причина, что и у боевого провайдера.
        Идентификатор короткий: у Яндекса он тоже короткий, и колонка рассчитана на это.
        """
        operation_id = f"mock-{uuid.uuid4().hex}"
        payload = json.dumps({"q": query, "r": str(region), "d": depth})
        client = _redis()
        if client is not None:
            client.setex(_key(operation_id), _TTL_SECONDS, payload)
        else:
            _MEMORY[operation_id] = payload
        return operation_id

    def fetch_deferred(self, operation_id: str) -> list[dict] | None:
        payload = _MEMORY.get(operation_id)
        if payload is None:
            client = _redis()
            raw = client.get(_key(operation_id)) if client is not None else None
            if raw is None:
                # Ключа нет: для боевого провайдера это истёкший результат, здесь — тоже.
                raise OperationExpiredError(f"Результат операции {operation_id} недоступен")
            payload = raw.decode("utf-8") if isinstance(raw, bytes) else raw

        data = json.loads(payload)
        return self._serp(data["q"], data["r"], int(data["d"]))

    def top_requests(
        self, phrase: str, *, region: str | None = None, num_phrases: int = 1
    ) -> WordstatResult:
        seed = _seed(phrase, str(region or ""))
        total = seed % 90_000 + 50
        results = [{"phrase": phrase, "count": total}]
        associations: list[dict] = []
        if num_phrases > 1:
            limit = min(num_phrases, len(_ASSOCIATION_TAILS))
            for i, tail in enumerate(_ASSOCIATION_TAILS[:limit]):
                associations.append(
                    {"phrase": f"{phrase} {tail}", "count": max(1, total // (i + 3))}
                )
        return WordstatResult(
            phrase=phrase, total_count=total, results=results, associations=associations
        )

    def regions_tree(self) -> list[dict]:
        return [
            {"code": "225", "name": "Россия", "parent_code": None},
            {"code": "213", "name": "Москва", "parent_code": "225"},
            {"code": "2", "name": "Санкт-Петербург", "parent_code": "225"},
            {"code": "65", "name": "Новосибирск", "parent_code": "225"},
            {"code": "54", "name": "Екатеринбург", "parent_code": "225"},
            {"code": "43", "name": "Казань", "parent_code": "225"},
            {"code": "47", "name": "Нижний Новгород", "parent_code": "225"},
            {"code": "35", "name": "Краснодар", "parent_code": "225"},
        ]


class DeferredMockProvider(MockProvider):
    """Как MockProvider, но первые N опросов честно отвечают «ещё не готово»."""

    def __init__(self, *args, not_ready_polls: int = 1, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.not_ready_polls = not_ready_polls
        self._polls: dict[str, int] = {}

    def fetch_deferred(self, operation_id: str) -> list[dict] | None:
        seen = self._polls.get(operation_id, 0)
        self._polls[operation_id] = seen + 1
        if seen < self.not_ready_polls:
            return None
        return super().fetch_deferred(operation_id)
