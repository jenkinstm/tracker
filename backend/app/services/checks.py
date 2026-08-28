"""Съём позиций: создание прогона, выполнение, разбор отложенных операций.

Работает на синхронной сессии — этот код живёт в Celery-воркере. Идемпотентность
обеспечивается уникальным ключом (project_id, target_id, scheduled_for) и upsert'ами
позиций по (keyword_id, target_id, checked_on).
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.config import settings
from app.models import (
    CheckRun,
    DeferredOperation,
    Keyword,
    Position,
    Project,
    ProjectTarget,
    SerpSnapshot,
)
from app.providers.base import ProviderError, QuotaExceededError, SerpProvider
from app.providers.registry import get_serp_provider, provider_price_per_1000
from app.services.cost import choose_mode, estimate_positions, sync_allowed
from app.services.partitions import PARTITIONED_TABLES, create_partition_sql
from app.services.serp_matching import find_position
from app.services.usage import limit_reached_sync, log_usage

log = logging.getLogger(__name__)


class RunRejected(RuntimeError):
    """Прогон не может быть запущен: нет фраз, исчерпан лимит, запрещён синхронный режим."""


def ensure_partitions(session: Session, day: date) -> None:
    """Партиция должна существовать до вставки: промах по партиции — отказ, а не
    медленный INSERT."""
    for table in PARTITIONED_TABLES:
        session.execute(text(create_partition_sql(table, day)))


def active_keywords(session: Session, project_id: uuid.UUID) -> list[Keyword]:
    return list(
        session.execute(
            select(Keyword)
            .where(Keyword.project_id == project_id, Keyword.is_active.is_(True))
            .order_by(Keyword.phrase)
        )
        .scalars()
        .all()
    )


def primary_target(session: Session, project_id: uuid.UUID) -> ProjectTarget | None:
    return session.execute(
        select(ProjectTarget)
        .where(ProjectTarget.project_id == project_id, ProjectTarget.is_enabled.is_(True))
        .order_by(ProjectTarget.sort_order, ProjectTarget.region_code)
    ).scalars().first()


def create_run(
    session: Session,
    *,
    project: Project,
    target: ProjectTarget,
    scheduled_for: date,
    trigger: str = "manual",
    keywords_total: int | None = None,
) -> CheckRun:
    """Идемпотентно: повторный запуск за ту же дату возвращает существующий прогон."""
    existing = session.execute(
        select(CheckRun).where(
            CheckRun.project_id == project.id,
            CheckRun.target_id == target.id,
            CheckRun.scheduled_for == scheduled_for,
        )
    ).scalar_one_or_none()

    total = (
        keywords_total
        if keywords_total is not None
        else len(active_keywords(session, project.id))
    )
    mode = choose_mode(total, trigger)

    if existing is not None:
        if existing.status in ("queued", "running"):
            return existing
        # Перезапуск за ту же дату: обновляем запись, а не плодим дубль.
        existing.status = "queued"
        existing.started_at = None
        existing.finished_at = None
        existing.keywords_total = total
        existing.keywords_done = 0
        existing.keywords_pending = 0
        existing.keywords_failed = 0
        existing.error = None
        existing.trigger = trigger
        existing.mode = mode
        session.flush()
        return existing

    run = CheckRun(
        project_id=project.id,
        target_id=target.id,
        status="queued",
        scheduled_for=scheduled_for,
        keywords_total=total,
        trigger=trigger,
        mode=mode,
    )
    session.add(run)
    session.flush()
    return run


def store_result(
    session: Session,
    *,
    run: CheckRun,
    target: ProjectTarget,
    project: Project,
    keyword: Keyword,
    results: list[dict],
) -> int | None:
    """Кладёт сырой ТОП-100 и вычисленную позицию. Повторный вызов обновляет, а не дублирует."""
    match = find_position(
        results,
        project.domain,
        match_subdomains=project.match_subdomains,
        depth=target.depth,
    )
    checked_on = run.scheduled_for

    session.execute(
        pg_insert(Position)
        .values(
            check_run_id=run.id,
            keyword_id=keyword.id,
            target_id=target.id,
            position=match.position,
            url=match.url,
            device=target.device,
            checked_on=checked_on,
        )
        .on_conflict_do_update(
            constraint="uq_position_keyword_date",
            set_={
                "position": match.position,
                "url": match.url,
                "check_run_id": run.id,
            },
        )
    )

    session.execute(
        pg_insert(SerpSnapshot)
        .values(
            check_run_id=run.id,
            keyword_id=keyword.id,
            target_id=target.id,
            results=results[: target.depth],
            checked_on=checked_on,
        )
        .on_conflict_do_update(
            constraint="uq_serp_keyword_date",
            set_={"results": results[: target.depth], "check_run_id": run.id},
        )
    )
    return match.position


def start_run(session: Session, run: CheckRun) -> tuple[Project, ProjectTarget, list[Keyword]]:
    project = session.get(Project, run.project_id)
    target = session.get(ProjectTarget, run.target_id)
    if project is None or target is None:
        raise RunRejected("Проект или цель проверки удалены")

    user = project.user
    if limit_reached_sync(session, user):
        run.status = "failed"
        run.error = "Месячный лимит расхода исчерпан, задача не запущена"
        run.finished_at = datetime.now(UTC)
        session.commit()
        raise RunRejected(run.error)

    keywords = active_keywords(session, project.id)
    if not keywords:
        run.status = "failed"
        run.error = "В проекте нет активных фраз"
        run.finished_at = datetime.now(UTC)
        session.commit()
        raise RunRejected(run.error)

    run.status = "running"
    run.started_at = datetime.now(UTC)
    run.keywords_total = len(keywords)
    run.keywords_done = 0
    run.keywords_failed = 0
    run.keywords_pending = 0
    ensure_partitions(session, run.scheduled_for)
    session.commit()
    return project, target, keywords


def execute_sync(
    session: Session,
    run: CheckRun,
    project: Project,
    target: ProjectTarget,
    keywords: list[Keyword],
    provider: SerpProvider,
) -> None:
    """Синхронный режим. Единственное место, где мы платим дорогую ставку, — осознанно."""
    if not sync_allowed(len(keywords)):
        raise RunRejected(
            f"Синхронный режим запрещён свыше {settings.sync_max_keywords} фраз: "
            "он дороже отложенного в шестнадцать раз"
        )

    price = provider_price_per_1000("serp_sync")
    for keyword in keywords:
        try:
            results = provider.search(
                keyword.phrase,
                region=target.region_code,
                depth=target.depth,
                fix_typos=project.fix_typos,
            )
        except QuotaExceededError as exc:
            run.error = f"Квота провайдера исчерпана: {exc}"
            log_usage(
                session,
                user_id=project.user_id,
                project_id=project.id,
                provider=provider.name,
                operation="serp_sync",
                requests=0,
                cost_kopecks=0,
                status="failed",
                error_code="quota_exceeded",
            )
            break
        except ProviderError as exc:
            # Падение одной фразы не блокирует остальные — это требование ТЗ.
            run.keywords_failed += 1
            log.warning("Фраза %s не снята: %s", keyword.phrase, exc)
            continue

        store_result(
            session, run=run, target=target, project=project, keyword=keyword, results=results
        )
        run.keywords_done += 1
        run.cost_kopecks += round(price / 1000)
        log_usage(
            session,
            user_id=project.user_id,
            project_id=project.id,
            provider=provider.name,
            operation="serp_sync",
            requests=1,
            cost_kopecks=round(price / 1000),
        )
        session.commit()

    finalize_run(session, run)


def execute_deferred(
    session: Session,
    run: CheckRun,
    project: Project,
    target: ProjectTarget,
    keywords: list[Keyword],
    provider: SerpProvider,
) -> None:
    """Ставит отложенные запросы и сохраняет operation_id.

    Результат живёт 12 часов; забирать его будет отдельная периодическая задача, а не
    этот воркер: перезапуск контейнера не должен стоить оплаченных данных.
    """
    ttl = timedelta(hours=settings.deferred_result_ttl_hours)
    price = provider_price_per_1000("serp_deferred")
    submitted = 0

    for keyword in keywords:
        try:
            operation_id = provider.submit_deferred(
                keyword.phrase,
                region=target.region_code,
                depth=target.depth,
                fix_typos=project.fix_typos,
            )
        except QuotaExceededError as exc:
            run.error = f"Квота провайдера исчерпана: {exc}"
            break
        except ProviderError as exc:
            run.keywords_failed += 1
            log.warning("Фраза %s не поставлена в очередь: %s", keyword.phrase, exc)
            continue

        now = datetime.now(UTC)
        session.add(
            DeferredOperation(
                operation_id=operation_id,
                check_run_id=run.id,
                keyword_id=keyword.id,
                submitted_at=now,
                expires_at=now + ttl,
                cost_kopecks=round(price / 1000),
            )
        )
        submitted += 1
        if submitted % 200 == 0:
            session.commit()

    run.keywords_pending = submitted
    run.cost_kopecks += round(submitted * price / 1000)
    if submitted:
        log_usage(
            session,
            user_id=project.user_id,
            project_id=project.id,
            provider=provider.name,
            operation="serp_deferred",
            requests=submitted,
            cost_kopecks=round(submitted * price / 1000),
        )
    session.commit()

    if submitted == 0:
        finalize_run(session, run)


def finalize_run(session: Session, run: CheckRun) -> None:
    """Прогон закрывается, когда не осталось ожидающих операций."""
    if run.keywords_pending > 0:
        session.commit()
        return
    if run.keywords_done == 0:
        run.status = "failed"
    elif run.keywords_failed > 0:
        # Часть фраз не снялась — это partial, а не тихий успех.
        run.status = "partial"
    else:
        run.status = "done"
    run.finished_at = datetime.now(UTC)
    session.commit()


def run_check(session: Session, run_id: uuid.UUID) -> CheckRun:
    run = session.get(CheckRun, run_id)
    if run is None:
        raise RunRejected("Прогон не найден")
    project, target, keywords = start_run(session, run)
    provider = get_serp_provider(own_domain=project.domain)

    if run.mode == "sync":
        execute_sync(session, run, project, target, keywords, provider)
    else:
        execute_deferred(session, run, project, target, keywords, provider)
    session.refresh(run)
    return run


def estimate_run(session: Session, project: Project, target: ProjectTarget, trigger: str) -> dict:
    keywords = len(active_keywords(session, project.id))
    mode = choose_mode(keywords, trigger)
    estimate = estimate_positions(
        keywords,
        engine=target.engine,
        depth=target.depth,
        mode=mode,
        price_per_1000_kopecks=provider_price_per_1000(
            "serp_sync" if mode == "sync" else "serp_deferred"
        ),
    )
    return estimate.as_dict()
