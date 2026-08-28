"""Определение позиции домена в выдаче.

Самое частое место расхождения с эталонными сервисами, поэтому здесь только чистые
функции без внешних зависимостей и с полным покрытием тестами.
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import unquote, urlsplit

__all__ = [
    "normalize_domain",
    "host_from_url",
    "is_domain_match",
    "find_position",
    "MatchResult",
]


def _to_ascii(host: str) -> str:
    """Кириллический домен приводим к punycode, чтобы «сайт.рф» и «xn--80aswg.xn--p1ai» совпали."""
    try:
        return host.encode("idna").decode("ascii")
    except (UnicodeError, UnicodeDecodeError):
        return host


def normalize_domain(value: str | None) -> str:
    """Хост без схемы, без www., без порта, в нижнем регистре, в punycode.

    Принимает как голый хост, так и полный URL: пользователь всё равно вставит что угодно.
    """
    if not value:
        return ""

    raw = value.strip()
    if not raw:
        return ""

    # urlsplit без схемы считает всё путём, поэтому схему при необходимости подставляем.
    if "//" not in raw:
        raw = "//" + raw
    parts = urlsplit(raw if raw.startswith("//") else raw)

    host = parts.hostname or ""
    if not host:
        # Строка вида "://" или мусор — вытаскиваем то, что похоже на хост.
        host = raw.lstrip("/").split("/")[0].split("?")[0].split("#")[0]
        host = host.split("@")[-1].split(":")[0]

    host = host.strip().strip(".").lower()
    if not host:
        return ""

    host = _to_ascii(host)
    if host.startswith("www."):
        host = host[4:]
    return host


def host_from_url(url: str | None) -> str:
    """Хост из URL результата выдачи. Отличается от normalize_domain только семантикой вызова."""
    return normalize_domain(url)


def is_domain_match(candidate: str, project_domain: str, *, match_subdomains: bool = False) -> bool:
    """Совпадает ли хост результата с доменом проекта.

    При match_subdomains=True совпадением считается и blog.example.com для example.com.
    Обратное направление совпадением не считается никогда: example.com не «принадлежит»
    поддомену blog.example.com.
    """
    left = normalize_domain(candidate)
    right = normalize_domain(project_domain)
    if not left or not right:
        return False
    if left == right:
        return True
    if match_subdomains:
        return left.endswith("." + right)
    return False


@dataclass(frozen=True)
class MatchResult:
    """Позиция и релевантный URL. position=None означает «нет в выдаче на заданной глубине»."""

    position: int | None
    url: str | None

    @property
    def found(self) -> bool:
        return self.position is not None


def find_position(
    results: list[dict],
    project_domain: str,
    *,
    match_subdomains: bool = False,
    depth: int | None = None,
) -> MatchResult:
    """Первое вхождение домена проекта в выдаче.

    Позиции считаются с единицы. Если домен встретился несколько раз, берём лучшую
    (наименьшую) позицию и её URL — # ASSUMPTION: в справке Topvisor правило явно не
    описано, но релевантный URL там ровно один на проверку, что этому не противоречит.

    Порядок определяется полем `pos`, если оно есть, иначе индексом в списке: провайдер
    может отдать результаты не по порядку.
    """
    domain = normalize_domain(project_domain)
    if not domain or not results:
        return MatchResult(None, None)

    best_pos: int | None = None
    best_url: str | None = None

    for index, item in enumerate(results, start=1):
        if not isinstance(item, dict):
            continue
        pos = item.get("pos")
        try:
            position = int(pos) if pos is not None else index
        except (TypeError, ValueError):
            position = index
        if position < 1:
            continue
        if depth is not None and position > depth:
            continue

        url = item.get("url") or ""
        candidate = item.get("domain") or host_from_url(url)
        if not is_domain_match(candidate, domain, match_subdomains=match_subdomains):
            continue

        if best_pos is None or position < best_pos:
            best_pos = position
            best_url = unquote(url) if url else None

    return MatchResult(best_pos, best_url)
