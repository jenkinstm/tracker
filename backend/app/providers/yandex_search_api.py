"""Yandex Search API v2: позиции (синхронно и отложенно) и Вордстат.

Один ключ сервисного аккаунта и один folderId на оба сервиса — это одна интеграция,
а не две. Грабли, заложенные в код, перечислены в docs/INTEGRATIONS.md, раздел 1.
"""

from __future__ import annotations

import base64
import logging
import xml.etree.ElementTree as ET
from typing import Any
from urllib.parse import urlparse

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from app.config import settings
from app.providers.base import (
    ProviderError,
    QuotaExceededError,
    WordstatResult,
)
from app.services.serp_matching import host_from_url

log = logging.getLogger(__name__)

SEARCH_ROOT = "https://searchapi.api.cloud.yandex.net/v2"
OPERATION_ROOT = "https://operation.api.cloud.yandex.net/operations"

def _is_retryable(exc: BaseException) -> bool:
    """Квоту ретраить бессмысленно: вернётся тот же отказ, только позже."""
    return isinstance(exc, ProviderError) and not isinstance(exc, QuotaExceededError)


retry_policy = retry(
    retry=retry_if_exception(_is_retryable),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    reraise=True,
)


class YandexSearchApiProvider:
    """Реализует и SerpProvider, и WordstatProvider."""

    name = "yandex_search_api"
    supports_deferred = True

    def __init__(
        self,
        api_key: str | None = None,
        folder_id: str | None = None,
        client: httpx.Client | None = None,
    ) -> None:
        self.api_key = api_key or settings.yandex_search_api_key
        self.folder_id = folder_id or settings.yandex_cloud_folder_id
        self._client = client

    # --- транспорт -------------------------------------------------------

    @property
    def client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(timeout=settings.request_timeout_seconds)
        return self._client

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Api-Key {self.api_key}",
            "Content-Type": "application/json",
        }

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.api_key:
            raise ProviderError("YANDEX_SEARCH_API_KEY не задан", code="no_credentials")
        if not self.folder_id:
            # folderId обязателен в теле каждого запроса, без него INVALID_ARGUMENT.
            raise ProviderError("YANDEX_CLOUD_FOLDER_ID не задан", code="no_folder")
        try:
            response = self.client.post(
                f"{SEARCH_ROOT}{path}", json=payload, headers=self._headers()
            )
        except httpx.HTTPError as exc:
            raise ProviderError(f"Сеть недоступна: {exc}", code="network") from exc
        return self._unwrap(response)

    @staticmethod
    def _unwrap(response: httpx.Response) -> dict[str, Any]:
        if response.status_code == 429:
            raise ProviderError("Слишком много запросов", code="rate_limited")
        if response.status_code in (402, 403):
            raise QuotaExceededError(f"Отказ провайдера: {response.text[:200]}")
        if response.status_code >= 400:
            text = response.text[:300]
            if "quota" in text.lower() or "limit" in text.lower():
                raise QuotaExceededError(text)
            raise ProviderError(f"HTTP {response.status_code}: {text}", code="http_error")
        try:
            return response.json()
        except ValueError as exc:
            raise ProviderError("Ответ не является JSON", code="bad_payload") from exc

    # --- позиции ---------------------------------------------------------

    def _search_payload(self, query: str, region: str, depth: int, fix_typos: bool) -> dict:
        return {
            "query": {
                "searchType": "SEARCH_TYPE_RU",
                "queryText": query,
                # # VERIFY: названия и регистр enum'ов сверить с ответом сервера при первом
                # боевом вызове — документация по ним неполная.
                "fixTypoMode": "FIX_TYPO_MODE_ON" if fix_typos else "FIX_TYPO_MODE_OFF",
                "familyMode": f"FAMILY_MODE_{settings.yandex_wordstat_filter_mode.upper()}",
            },
            "groupSpec": {
                "groupMode": "GROUP_MODE_FLAT",
                "groupsOnPage": min(depth, 100),
                "docsInGroup": 1,
            },
            "region": str(region),
            "l10N": "LOCALIZATION_RU",
            "folderId": self.folder_id,
            "responseFormat": "FORMAT_XML",
        }

    @retry_policy
    def search(
        self, query: str, *, region: str, depth: int = 100, fix_typos: bool = True
    ) -> list[dict]:
        data = self._post("/web/search", self._search_payload(query, region, depth, fix_typos))
        return parse_serp(data.get("rawData", ""), depth=depth)

    @retry_policy
    def submit_deferred(
        self, query: str, *, region: str, depth: int = 100, fix_typos: bool = True
    ) -> str:
        data = self._post(
            "/web/searchAsync", self._search_payload(query, region, depth, fix_typos)
        )
        operation_id = data.get("id")
        if not operation_id:
            raise ProviderError("Ответ без id операции", code="bad_payload")
        return str(operation_id)

    @retry_policy
    def fetch_deferred(self, operation_id: str) -> list[dict] | None:
        try:
            response = self.client.get(
                f"{OPERATION_ROOT}/{operation_id}", headers=self._headers()
            )
        except httpx.HTTPError as exc:
            raise ProviderError(f"Сеть недоступна: {exc}", code="network") from exc
        data = self._unwrap(response)
        if not data.get("done"):
            return None
        if "error" in data and data["error"]:
            message = str(data["error"].get("message", "неизвестная ошибка"))
            raise ProviderError(message, code="operation_failed")
        raw = (data.get("response") or {}).get("rawData", "")
        return parse_serp(raw)

    # --- частотность -----------------------------------------------------

    @retry_policy
    def top_requests(
        self, phrase: str, *, region: str | None = None, num_phrases: int = 1
    ) -> WordstatResult:
        payload: dict[str, Any] = {
            "folderId": self.folder_id,
            "phrase": phrase,
            "numPhrases": num_phrases,
        }
        if region:
            payload["regions"] = [str(region)]
        data = self._post("/wordstat/topRequests", payload)
        return parse_wordstat(phrase, data)

    @retry_policy
    def regions_tree(self) -> list[dict]:
        data = self._post("/wordstat/getRegionsTree", {"folderId": self.folder_id})
        return flatten_regions(data.get("regions", []))


# --- разбор ответов (чистые функции, тестируются отдельно) -----------------


def _as_int(value: Any) -> int:
    """protobuf int64 сериализуется в JSON строкой — всегда приводим явно."""
    if value is None:
        return 0
    if isinstance(value, bool):
        return int(value)
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return 0


def parse_serp(raw_data: str, *, depth: int = 100) -> list[dict]:
    """Search API отдаёт выдачу в base64-упакованном XML."""
    if not raw_data:
        return []
    try:
        xml_bytes = base64.b64decode(raw_data)
    except (ValueError, TypeError) as exc:
        raise ProviderError("rawData не декодируется из base64", code="bad_payload") from exc
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise ProviderError("rawData не разбирается как XML", code="bad_payload") from exc

    error = root.find(".//response/error")
    if error is not None and (error.text or "").strip():
        text = error.text or ""
        if "limit" in text.lower() or "quota" in text.lower():
            raise QuotaExceededError(text)
        raise ProviderError(text, code="serp_error")

    items: list[dict] = []
    for doc in root.iter("doc"):
        url = (doc.findtext("url") or "").strip()
        if not url:
            continue
        title_node = doc.find("title")
        title = "".join(title_node.itertext()).strip() if title_node is not None else ""
        domain = (doc.findtext("domain") or "").strip() or host_from_url(url)
        items.append(
            {
                "pos": len(items) + 1,
                "url": url,
                "domain": host_from_url(domain) or domain.lower(),
                "title": title,
            }
        )
        if len(items) >= depth:
            break
    return items


def parse_wordstat(phrase: str, data: dict[str, Any]) -> WordstatResult:
    """Разбор topRequests со всеми известными граблями."""
    total = _as_int(data.get("totalCount"))

    results: list[dict] = []
    for row in data.get("results") or []:
        results.append(
            {"phrase": (row.get("phrase") or "").strip(), "count": _as_int(row.get("count"))}
        )

    # associations может отсутствовать на узких запросах — приходит пустым массивом, не null.
    associations: list[dict] = []
    for row in data.get("associations") or []:
        associations.append(
            {"phrase": (row.get("phrase") or "").strip(), "count": _as_int(row.get("count"))}
        )

    # results[0] — не обязательно запрошенная фраза. Ищем по тексту, нулевой индекс не берём.
    if not total:
        from app.services.text import normalize_phrase

        wanted = normalize_phrase(phrase)
        for row in results:
            if normalize_phrase(row["phrase"]) == wanted:
                total = row["count"]
                break

    return WordstatResult(
        phrase=phrase, total_count=total, results=results, associations=associations
    )


def flatten_regions(nodes: list[dict], parent: str | None = None) -> list[dict]:
    """Дерево регионов разворачиваем в плоский список для таблицы regions."""
    flat: list[dict] = []
    for node in nodes or []:
        code = str(node.get("id") or node.get("code") or "").strip()
        if not code:
            continue
        flat.append({"code": code, "name": (node.get("name") or "").strip(), "parent_code": parent})
        children = node.get("children") or node.get("regions") or []
        flat.extend(flatten_regions(children, code))
    return flat


def domain_of(url: str) -> str:
    return (urlparse(url).hostname or "").lower()
