"""Тесты ядра определения позиции. Фундамент точности сервиса — сюрпризов быть не должно."""

import pytest

from app.services.serp_matching import (
    find_position,
    host_from_url,
    is_domain_match,
    normalize_domain,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("example.com", "example.com"),
        ("www.example.com", "example.com"),
        ("WWW.Example.COM", "example.com"),
        ("http://example.com", "example.com"),
        ("https://example.com/", "example.com"),
        ("https://www.example.com/catalog/okna?utm_source=ya#top", "example.com"),
        ("https://example.com:8443/page", "example.com"),
        ("example.com.", "example.com"),
        ("  https://example.com  ", "example.com"),
        ("https://user:pass@example.com/x", "example.com"),
        ("//example.com/x", "example.com"),
        ("ftp://example.com/file", "example.com"),
        ("blog.example.com", "blog.example.com"),
        ("www.blog.example.com", "blog.example.com"),
    ],
)
def test_normalize_domain(raw, expected):
    assert normalize_domain(raw) == expected


@pytest.mark.parametrize("raw", ["", "   ", None])
def test_normalize_domain_empty(raw):
    assert normalize_domain(raw) == ""


def test_normalize_domain_idn_to_punycode():
    assert normalize_domain("https://пример.рф/окна") == "xn--e1afmkfd.xn--p1ai"


def test_normalize_domain_punycode_stays_punycode():
    assert normalize_domain("xn--e1afmkfd.xn--p1ai") == "xn--e1afmkfd.xn--p1ai"


def test_idn_and_punycode_are_the_same_domain():
    assert is_domain_match("https://пример.рф/page", "xn--e1afmkfd.xn--p1ai")


def test_host_from_url_strips_query_and_fragment():
    assert host_from_url("https://www.example.com/?utm=1&a=2#z") == "example.com"


def test_match_exact():
    assert is_domain_match("https://www.example.com/page", "example.com")


def test_match_ignores_scheme_and_port():
    assert is_domain_match("http://example.com:80/a", "https://example.com")


def test_subdomain_not_matched_by_default():
    assert not is_domain_match("https://blog.example.com/a", "example.com")


def test_subdomain_matched_when_enabled():
    assert is_domain_match("https://blog.example.com/a", "example.com", match_subdomains=True)


def test_deep_subdomain_matched_when_enabled():
    assert is_domain_match("https://a.b.example.com/", "example.com", match_subdomains=True)


def test_parent_domain_never_matches_subdomain_project():
    assert not is_domain_match("https://example.com/", "blog.example.com", match_subdomains=True)


def test_similar_suffix_is_not_a_match():
    """notexample.com не должен считаться поддоменом example.com."""
    assert not is_domain_match("https://notexample.com/", "example.com", match_subdomains=True)


def test_empty_candidate_is_not_a_match():
    assert not is_domain_match("", "example.com")


def test_empty_project_domain_is_not_a_match():
    assert not is_domain_match("https://example.com", "")


def _serp(*hosts: str) -> list[dict]:
    return [
        {"pos": i, "url": f"https://{h}/page-{i}", "domain": h, "title": f"t{i}"}
        for i, h in enumerate(hosts, start=1)
    ]


def test_find_position_simple():
    res = find_position(_serp("a.ru", "example.com", "b.ru"), "example.com")
    assert res.position == 2
    assert res.url == "https://example.com/page-2"
    assert res.found


def test_find_position_not_found():
    res = find_position(_serp("a.ru", "b.ru"), "example.com")
    assert res.position is None
    assert res.url is None
    assert not res.found


def test_find_position_empty_serp():
    assert find_position([], "example.com").position is None


def test_find_position_takes_best_of_several():
    serp = _serp("a.ru", "example.com", "b.ru", "example.com")
    assert find_position(serp, "example.com").position == 2


def test_find_position_best_even_if_order_broken():
    serp = [
        {"pos": 7, "url": "https://example.com/seven", "domain": "example.com"},
        {"pos": 3, "url": "https://example.com/three", "domain": "example.com"},
    ]
    res = find_position(serp, "example.com")
    assert res.position == 3
    assert res.url == "https://example.com/three"


def test_find_position_uses_index_when_pos_missing():
    serp = [{"url": "https://a.ru/"}, {"url": "https://example.com/x"}]
    assert find_position(serp, "example.com").position == 2


def test_find_position_derives_domain_from_url():
    serp = [{"pos": 1, "url": "https://www.example.com/deep/page?utm=1"}]
    assert find_position(serp, "example.com").position == 1


def test_find_position_respects_depth():
    serp = _serp(*["a.ru"] * 99, "example.com")
    assert find_position(serp, "example.com", depth=100).position == 100
    assert find_position(serp, "example.com", depth=50).position is None


def test_find_position_subdomain_flag_off():
    serp = _serp("blog.example.com")
    assert find_position(serp, "example.com").position is None


def test_find_position_subdomain_flag_on():
    serp = _serp("blog.example.com")
    res = find_position(serp, "example.com", match_subdomains=True)
    assert res.position == 1
    assert res.url == "https://blog.example.com/page-1"


def test_find_position_www_in_serp_matches_bare_project_domain():
    serp = [{"pos": 1, "url": "https://www.example.com/", "domain": "www.example.com"}]
    assert find_position(serp, "example.com").position == 1


def test_find_position_skips_garbage_items():
    serp = ["мусор", None, {"pos": 2, "url": "https://example.com/x", "domain": "example.com"}]
    assert find_position(serp, "example.com").position == 2


def test_find_position_ignores_broken_pos_value():
    serp = [{"pos": "не число", "url": "https://example.com/x"}]
    assert find_position(serp, "example.com").position == 1


def test_find_position_skips_non_positive_pos():
    serp = [{"pos": 0, "url": "https://example.com/x"}]
    assert find_position(serp, "example.com").position is None


def test_find_position_decodes_percent_encoded_url():
    encoded = "https://example.com/%D0%BE%D0%BA%D0%BD%D0%B0"
    serp = [{"pos": 1, "url": encoded, "domain": "example.com"}]
    assert find_position(serp, "example.com").url == "https://example.com/окна"


def test_find_position_idn_project_domain():
    serp = [{"pos": 4, "url": "https://xn--e1afmkfd.xn--p1ai/x", "domain": "xn--e1afmkfd.xn--p1ai"}]
    assert find_position(serp, "пример.рф").position == 4


def test_find_position_empty_project_domain():
    assert find_position(_serp("example.com"), "").position is None
