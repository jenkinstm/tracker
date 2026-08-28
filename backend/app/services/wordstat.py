"""Сбор частотности.

Самая дорогая операция сервиса: 100 ₽ за тысячу фраз против 30 ₽ за тысячу проверок
позиций. Поэтому по умолчанию собираем только то, чего ещё нет, а повторный сбор по
свежему снимку требует явного подтверждения.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Keyword, Project, WordstatAssociation, WordstatSnapshot
from app.providers.base import ProviderError, QuotaExceededError, WordstatProvider
from app.providers.registry import get_wordstat_provider, provider_price_per_1000
from app.services.text import normalize_phrase
from app.services.usage import log_usage

log = logging.getLogger(__name__)


def fresh_keyword_ids(session: Session, project_id: uuid.UUID) -> set[uuid.UUID]:
    """Фразы, у которых уже есть снимок моложе wordstat_fresh_days."""
    since = datetime.now(UTC) - timedelta(days=settings.wordstat_fresh_days)
    rows = session.execute(
        select(WordstatSnapshot.keyword_id)
        .join(Keyword, Keyword.id == WordstatSnapshot.keyword_id)
        .where(Keyword.project_id == project_id, WordstatSnapshot.collected_at >= since)
        .distinct()
    ).scalars().all()
    return set(rows)


def select_keywords(
    session: Session,
    project_id: uuid.UUID,
    *,
    keyword_ids: list[uuid.UUID] | None = None,
    only_missing: bool = True,
) -> tuple[list[Keyword], int]:
    """Возвращает фразы к сбору и число пропущенных как свежие."""
    query = select(Keyword).where(Keyword.project_id == project_id, Keyword.is_active.is_(True))
    if keyword_ids:
        query = query.where(Keyword.id.in_(keyword_ids))
    keywords = list(session.execute(query.order_by(Keyword.phrase)).scalars().all())

    if not only_missing:
        return keywords, 0

    fresh = fresh_keyword_ids(session, project_id)
    selected = [k for k in keywords if k.id not in fresh]
    return selected, len(keywords) - len(selected)


def filter_associations(
    associations: list[dict], source_phrase: str, min_count: int | None = None
) -> list[dict]:
    """Ассоциации шумные: рядом с полезным приходят смежные ниши и обрубки слов.

    Отсекаем частотность ниже порога и фразы без общего слова с исходной. Порог мягкий,
    финальное решение всё равно за человеком — автодобавление в проект запрещено.
    """
    threshold = settings.wordstat_association_min_count if min_count is None else min_count
    source_words = {w for w in normalize_phrase(source_phrase).split() if len(w) > 3}

    kept: list[dict] = []
    for row in associations:
        phrase = (row.get("phrase") or "").strip()
        count = int(row.get("count") or 0)
        if not phrase or count < threshold:
            continue
        words = set(normalize_phrase(phrase).split())
        if source_words and not (source_words & words):
            continue
        kept.append({"phrase": phrase, "count": count})
    return kept


def collect_for_keywords(
    session: Session,
    project: Project,
    keywords: list[Keyword],
    region_code: str | None,
    *,
    provider: WordstatProvider | None = None,
    num_phrases: int | None = None,
    store_associations: bool = False,
) -> dict:
    """Сбор всегда синхронный: у Вордстата отложенного режима нет."""
    provider = provider or get_wordstat_provider()
    num = num_phrases or settings.yandex_wordstat_num_phrases
    price = provider_price_per_1000("wordstat_top")
    collected = failed = 0

    for keyword in keywords:
        try:
            result = provider.top_requests(
                keyword.phrase, region=region_code, num_phrases=num
            )
        except QuotaExceededError as exc:
            log.error("Сбор частотности остановлен: %s", exc)
            log_usage(
                session,
                user_id=project.user_id,
                project_id=project.id,
                provider=getattr(provider, "name", "unknown"),
                operation="wordstat_top",
                requests=0,
                cost_kopecks=0,
                status="failed",
                error_code="quota_exceeded",
            )
            break
        except ProviderError as exc:
            failed += 1
            log.warning("Частотность для «%s» не собрана: %s", keyword.phrase, exc)
            continue

        session.add(
            WordstatSnapshot(
                keyword_id=keyword.id,
                region_yandex=int(region_code) if (region_code or "").isdigit() else None,
                freq_base=result.total_count,
                # Search API операторы не поддерживает — точная частотность остаётся null.
                freq_exact=None,
                freq_exact_form=None,
                provider=getattr(provider, "name", "unknown"),
            )
        )

        if store_associations:
            for row in filter_associations(result.associations, keyword.phrase):
                session.add(
                    WordstatAssociation(
                        keyword_id=keyword.id,
                        phrase=row["phrase"],
                        count=row["count"],
                        kind="association",
                    )
                )

        collected += 1
        log_usage(
            session,
            user_id=project.user_id,
            project_id=project.id,
            provider=getattr(provider, "name", "unknown"),
            operation="wordstat_top",
            requests=1,
            cost_kopecks=round(price / 1000),
        )
        if collected % 100 == 0:
            session.commit()

    session.commit()
    return {"collected": collected, "failed": failed}
