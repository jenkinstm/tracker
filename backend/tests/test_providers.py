"""Тесты провайдера Yandex Search API. Реальных сетевых вызовов здесь нет и быть не должно."""

import base64
from datetime import date

import httpx
import pytest
import respx

from app.providers.base import ProviderError, QuotaExceededError
from app.providers.yandex_search_api import (
    SEARCH_ROOT,
    YandexSearchApiProvider,
    _as_int,
    flatten_regions,
    parse_serp,
    parse_wordstat,
)
from app.services.dates import last_day_of_period, normalize_period

SERP_XML = """<?xml version="1.0" encoding="utf-8"?>
<yandexsearch version="1.0">
  <response>
    <results>
      <grouping>
        <group><doc><url>https://www.konkurent.ru/a</url><domain>www.konkurent.ru</domain>
          <title>Первый</title></doc></group>
        <group><doc><url>https://example.com/catalog/okna?utm=1</url><domain>example.com</domain>
          <title>Окна <hlword>дёшево</hlword></title></doc></group>
      </grouping>
    </results>
  </response>
</yandexsearch>"""

QUOTA_XML = """<?xml version="1.0" encoding="utf-8"?>
<yandexsearch version="1.0">
  <response><error code="55">Daily request limit exceeded</error></response>
</yandexsearch>"""


def b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def provider() -> YandexSearchApiProvider:
    return YandexSearchApiProvider(api_key="test-key", folder_id="b1gtest")


# --- разбор выдачи ---------------------------------------------------------


def test_parse_serp_numbers_positions_from_one():
    items = parse_serp(b64(SERP_XML))
    assert [i["pos"] for i in items] == [1, 2]


def test_parse_serp_normalizes_domain():
    items = parse_serp(b64(SERP_XML))
    assert items[0]["domain"] == "konkurent.ru"


def test_parse_serp_collects_title_with_highlights():
    items = parse_serp(b64(SERP_XML))
    assert items[1]["title"] == "Окна дёшево"


def test_parse_serp_respects_depth():
    assert len(parse_serp(b64(SERP_XML), depth=1)) == 1


def test_parse_serp_empty_raw_data():
    assert parse_serp("") == []


def test_parse_serp_quota_error_is_not_retryable():
    with pytest.raises(QuotaExceededError):
        parse_serp(b64(QUOTA_XML))


def test_parse_serp_broken_base64():
    with pytest.raises(ProviderError):
        parse_serp("не base64 ###")


# --- грабли Вордстата ------------------------------------------------------


def test_wordstat_count_arrives_as_string():
    """protobuf int64 сериализуется строкой — арифметика на ней падает."""
    assert _as_int("47543") == 47543


def test_wordstat_total_count_is_parsed_as_int():
    result = parse_wordstat("купить окна", {"totalCount": "47543", "results": []})
    assert result.total_count == 47543
    assert isinstance(result.total_count, int)


def test_wordstat_empty_associations_is_not_none():
    result = parse_wordstat("узкий запрос", {"totalCount": "12", "associations": []})
    assert result.associations == []


def test_wordstat_missing_associations_key():
    result = parse_wordstat("узкий запрос", {"totalCount": "12"})
    assert result.associations == []


def test_wordstat_first_result_is_not_necessarily_the_asked_phrase():
    """results[0] может быть чужой фразой — ищем по нормализованному тексту."""
    data = {
        "results": [
            {"phrase": "купить пластиковые окна", "count": "16862"},
            {"phrase": "Купить  ОКНА", "count": "47543"},
        ]
    }
    assert parse_wordstat("купить окна", data).total_count == 47543


def test_wordstat_phrase_absent_from_results_gives_zero():
    data = {"results": [{"phrase": "совсем другое", "count": "10"}]}
    assert parse_wordstat("купить окна", data).total_count == 0


def test_period_requires_prefix():
    assert normalize_period("monthly") == "PERIOD_MONTHLY"
    assert normalize_period("PERIOD_WEEKLY") == "PERIOD_WEEKLY"


def test_unknown_period_rejected():
    with pytest.raises(ValueError):
        normalize_period("hourly")


def test_monthly_to_date_is_last_day_of_month():
    assert last_day_of_period(date(2026, 2, 3), "monthly") == date(2026, 2, 28)
    assert last_day_of_period(date(2024, 2, 3), "monthly") == date(2024, 2, 29)


def test_weekly_to_date_is_sunday():
    assert last_day_of_period(date(2026, 8, 26), "weekly") == date(2026, 8, 30)


def test_daily_to_date_is_the_day_itself():
    assert last_day_of_period(date(2026, 8, 26), "daily") == date(2026, 8, 26)


@respx.mock
def test_folder_id_is_sent_in_every_request():
    """Без folderId в теле — INVALID_ARGUMENT."""
    route = respx.post(f"{SEARCH_ROOT}/wordstat/topRequests").mock(
        return_value=httpx.Response(200, json={"totalCount": "100", "results": []})
    )
    provider().top_requests("окна", region="213")
    assert route.calls.last.request.read().decode().count("b1gtest") == 1


def test_missing_folder_id_fails_fast():
    bad = YandexSearchApiProvider(api_key="k", folder_id="")
    with pytest.raises(ProviderError) as exc:
        bad.top_requests("окна")
    assert exc.value.code == "no_folder"


def test_missing_api_key_fails_fast():
    bad = YandexSearchApiProvider(api_key="", folder_id="b1g")
    with pytest.raises(ProviderError) as exc:
        bad.top_requests("окна")
    assert exc.value.code == "no_credentials"


def test_operators_are_not_supported_so_freq_exact_stays_none():
    """Кавычки в Search API не работают: точную частотность отсюда не получить."""
    result = parse_wordstat('"купить окна"', {"totalCount": "47543"})
    assert result.total_count == 47543
    assert not hasattr(result, "freq_exact")


# --- транспорт: ретраи, квота, отложенный режим ----------------------------


@respx.mock
def test_search_retries_three_times_then_raises():
    route = respx.post(f"{SEARCH_ROOT}/web/search").mock(
        return_value=httpx.Response(500, text="boom")
    )
    with pytest.raises(ProviderError):
        provider().search("окна", region="213")
    assert route.call_count == 3


@respx.mock
def test_search_recovers_on_second_attempt():
    route = respx.post(f"{SEARCH_ROOT}/web/search")
    route.side_effect = [
        httpx.Response(503, text="unavailable"),
        httpx.Response(200, json={"rawData": b64(SERP_XML)}),
    ]
    items = provider().search("окна", region="213")
    assert len(items) == 2
    assert route.call_count == 2


@respx.mock
def test_quota_exceeded_is_not_retried():
    route = respx.post(f"{SEARCH_ROOT}/web/search").mock(
        return_value=httpx.Response(403, text="quota exceeded")
    )
    with pytest.raises(QuotaExceededError):
        provider().search("окна", region="213")
    assert route.call_count == 1


@respx.mock
def test_rate_limit_is_retried():
    route = respx.post(f"{SEARCH_ROOT}/web/search").mock(return_value=httpx.Response(429))
    with pytest.raises(ProviderError) as exc:
        provider().search("окна", region="213")
    assert exc.value.code == "rate_limited"
    assert route.call_count == 3


@respx.mock
def test_submit_deferred_returns_operation_id():
    respx.post(f"{SEARCH_ROOT}/web/searchAsync").mock(
        return_value=httpx.Response(200, json={"id": "op-42", "done": False})
    )
    assert provider().submit_deferred("окна", region="213") == "op-42"


@respx.mock
def test_fetch_deferred_returns_none_while_not_done():
    respx.get("https://operation.api.cloud.yandex.net/operations/op-42").mock(
        return_value=httpx.Response(200, json={"id": "op-42", "done": False})
    )
    assert provider().fetch_deferred("op-42") is None


@respx.mock
def test_fetch_deferred_returns_results_when_done():
    respx.get("https://operation.api.cloud.yandex.net/operations/op-42").mock(
        return_value=httpx.Response(
            200, json={"id": "op-42", "done": True, "response": {"rawData": b64(SERP_XML)}}
        )
    )
    items = provider().fetch_deferred("op-42")
    assert items is not None and items[1]["domain"] == "example.com"


@respx.mock
def test_fetch_deferred_raises_on_operation_error():
    respx.get("https://operation.api.cloud.yandex.net/operations/op-42").mock(
        return_value=httpx.Response(
            200, json={"id": "op-42", "done": True, "error": {"message": "внутренняя ошибка"}}
        )
    )
    with pytest.raises(ProviderError):
        provider().fetch_deferred("op-42")


def test_flatten_regions_keeps_parents():
    tree = [{"id": "225", "name": "Россия", "children": [{"id": "213", "name": "Москва"}]}]
    flat = flatten_regions(tree)
    assert flat == [
        {"code": "225", "name": "Россия", "parent_code": None},
        {"code": "213", "name": "Москва", "parent_code": "225"},
    ]
