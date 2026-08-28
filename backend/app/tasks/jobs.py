"""Задачи Celery."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select, text

from app.config import settings
from app.db import SyncSessionMaker
from app.models import CheckRun, DeferredOperation, Keyword, Project, ProjectTarget
from app.providers.base import ProviderError
from app.providers.registry import get_serp_provider
from app.services import checks, wordstat
from app.services.partitions import (
    PARTITIONED_TABLES,
    create_partition_sql,
    months_around,
    partition_name,
)
from app.tasks.celery_app import celery_app

log = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.jobs.run_position_check")
def run_position_check(run_id: str) -> dict:
    with SyncSessionMaker() as session:
        try:
            run = checks.run_check(session, uuid.UUID(run_id))
        except checks.RunRejected as exc:
            log.warning("Прогон %s отклонён: %s", run_id, exc)
            return {"run_id": run_id, "status": "rejected", "error": str(exc)}
        return {
            "run_id": run_id,
            "status": run.status,
            "done": run.keywords_done,
            "pending": run.keywords_pending,
            "failed": run.keywords_failed,
        }


@celery_app.task(name="app.tasks.jobs.collect_wordstat")
def collect_wordstat(
    project_id: str, keyword_ids: list[str] | None = None, only_missing: bool = True
) -> dict:
    with SyncSessionMaker() as session:
        project = session.get(Project, uuid.UUID(project_id))
        if project is None:
            return {"error": "Проект не найден"}
        target = checks.primary_target(session, project.id)
        selected, skipped = wordstat.select_keywords(
            session,
            project.id,
            keyword_ids=[uuid.UUID(k) for k in keyword_ids] if keyword_ids else None,
            only_missing=only_missing,
        )
        result = wordstat.collect_for_keywords(
            session, project, selected, target.region_code if target else None
        )
        return {**result, "skipped_fresh": skipped}


@celery_app.task(name="app.tasks.jobs.expand_semantics")
def expand_semantics(keyword_id: str) -> dict:
    """Точечное расширение семантики: numPhrases=2000, ассоциации сохраняются.

    В фоновом сборе частотности этого не делаем — тысячи мусорных фраз никто не разберёт.
    """
    with SyncSessionMaker() as session:
        keyword = session.get(Keyword, uuid.UUID(keyword_id))
        if keyword is None:
            return {"error": "Фраза не найдена"}
        project = session.get(Project, keyword.project_id)
        target = checks.primary_target(session, project.id)
        return wordstat.collect_for_keywords(
            session,
            project,
            [keyword],
            target.region_code if target else None,
            num_phrases=2000,
            store_associations=True,
        )


@celery_app.task(name="app.tasks.jobs.poll_deferred_operations")
def poll_deferred_operations(limit: int = 500) -> dict:
    """Забирает готовые отложенные результаты.

    Опрос ведёт эта задача, а не воркер, поставивший запрос: перезапуск контейнера не
    должен стоить оплаченных данных. Первый опрос — не раньше чем через пять минут:
    раньше результата не бывает.
    """
    now = datetime.now(UTC)
    not_before = now - timedelta(seconds=settings.deferred_first_poll_delay_seconds)
    fetched = expired = still_pending = failed = 0

    with SyncSessionMaker() as session:
        operations = list(
            session.execute(
                select(DeferredOperation)
                .where(
                    DeferredOperation.status == "pending",
                    DeferredOperation.submitted_at <= not_before,
                )
                .order_by(DeferredOperation.submitted_at)
                .limit(limit)
            )
            .scalars()
            .all()
        )

        for operation in operations:
            run = session.get(CheckRun, operation.check_run_id)
            if run is None:
                operation.status = "failed"
                continue
            project = session.get(Project, run.project_id)
            target = session.get(ProjectTarget, run.target_id)
            keyword = session.get(Keyword, operation.keyword_id)
            if project is None or target is None or keyword is None:
                operation.status = "failed"
                continue

            if operation.expires_at <= now:
                # Просроченная операция — это оплаченные и выброшенные деньги.
                operation.status = "expired"
                expired += 1
                _resubmit(session, operation, run, project, target, keyword)
                continue

            provider = get_serp_provider(own_domain=project.domain)
            operation.poll_attempts += 1
            operation.last_polled_at = now
            try:
                results = provider.fetch_deferred(operation.operation_id)
            except ProviderError as exc:
                log.warning("Операция %s не забрана: %s", operation.operation_id, exc)
                operation.status = "failed"
                run.keywords_failed += 1
                run.keywords_pending = max(0, run.keywords_pending - 1)
                failed += 1
                continue

            if results is None:
                still_pending += 1
                continue

            checks.ensure_partitions(session, run.scheduled_for)
            checks.store_result(
                session, run=run, target=target, project=project, keyword=keyword, results=results
            )
            operation.status = "done"
            run.keywords_done += 1
            run.keywords_pending = max(0, run.keywords_pending - 1)
            fetched += 1

            if run.keywords_pending == 0:
                checks.finalize_run(session, run)

        session.commit()

    return {
        "fetched": fetched,
        "expired": expired,
        "pending": still_pending,
        "failed": failed,
    }


def _resubmit(session, operation, run, project, target, keyword) -> None:
    """Переотправляем просроченную операцию: данные потеряны, но фраза нужна."""
    if operation.retry_of:
        # Второй промах подряд — не крутим карусель, помечаем фразу как несобранную.
        run.keywords_failed += 1
        run.keywords_pending = max(0, run.keywords_pending - 1)
        return
    provider = get_serp_provider(own_domain=project.domain)
    try:
        new_id = provider.submit_deferred(
            keyword.phrase,
            region=target.region_code,
            depth=target.depth,
            fix_typos=project.fix_typos,
        )
    except ProviderError as exc:
        log.error("Переотправка операции %s не удалась: %s", operation.operation_id, exc)
        run.keywords_failed += 1
        run.keywords_pending = max(0, run.keywords_pending - 1)
        return

    now = datetime.now(UTC)
    session.add(
        DeferredOperation(
            operation_id=new_id,
            check_run_id=run.id,
            keyword_id=keyword.id,
            submitted_at=now,
            expires_at=now + timedelta(hours=settings.deferred_result_ttl_hours),
            cost_kopecks=operation.cost_kopecks,
            retry_of=operation.operation_id,
        )
    )


@celery_app.task(name="app.tasks.jobs.schedule_project_runs")
def schedule_project_runs() -> dict:
    """Ставит съёмы по расписанию проектов.

    Проекты разносим по минутам: бить в API пачкой в 08:00 незачем.
    """
    started = 0
    now_utc = datetime.now(UTC)

    with SyncSessionMaker() as session:
        projects = list(
            session.execute(
                select(Project).where(
                    Project.is_active.is_(True), Project.schedule.in_(("daily", "weekly"))
                )
            )
            .scalars()
            .all()
        )

        for project in projects:
            try:
                local = now_utc.astimezone(ZoneInfo(project.timezone))
            except Exception:  # noqa: BLE001 — кривая зона не должна ронять планировщик
                local = now_utc

            if project.schedule == "weekly" and local.weekday() != 0:
                continue

            offset = _minute_offset(project.id)
            scheduled = project.schedule_time.hour * 60 + project.schedule_time.minute + offset
            current = local.hour * 60 + local.minute
            if not 0 <= current - scheduled < 5:
                continue

            target = checks.primary_target(session, project.id)
            if target is None:
                continue

            existing = session.execute(
                select(CheckRun).where(
                    CheckRun.project_id == project.id,
                    CheckRun.target_id == target.id,
                    CheckRun.scheduled_for == local.date(),
                )
            ).scalar_one_or_none()
            if existing is not None:
                continue

            run = checks.create_run(
                session,
                project=project,
                target=target,
                scheduled_for=local.date(),
                trigger="schedule",
            )
            session.commit()
            run_position_check.delay(str(run.id))
            started += 1

    return {"started": started}


def _minute_offset(project_id: uuid.UUID) -> int:
    """Стабильный сдвиг 0–29 минут, чтобы проекты не били в API одновременно."""
    return project_id.int % 30


@celery_app.task(name="app.tasks.jobs.maintain_partitions")
def maintain_partitions() -> dict:
    """Создаёт партиции вперёд и удаляет снимки выдачи старше 90 дней."""
    created = dropped = 0
    today = date.today()

    with SyncSessionMaker() as session:
        for table in PARTITIONED_TABLES:
            for month in months_around(today, back=0, ahead=3):
                session.execute(text(create_partition_sql(table, month)))
                created += 1

        cutoff = today - timedelta(days=90)
        rows = session.execute(
            text(
                "SELECT c.relname FROM pg_class c "
                "JOIN pg_inherits i ON i.inhrelid = c.oid "
                "JOIN pg_class p ON p.oid = i.inhparent "
                "WHERE p.relname = 'serp_snapshots'"
            )
        ).scalars().all()
        for name in rows:
            month = _month_of_partition(name)
            if month is not None and month < cutoff.replace(day=1):
                session.execute(text(f"DROP TABLE IF EXISTS {name}"))
                dropped += 1
        session.commit()

    return {"created": created, "dropped": dropped}


def _month_of_partition(name: str) -> date | None:
    suffix = name.rsplit("_p", 1)[-1]
    if len(suffix) != 6 or not suffix.isdigit():
        return None
    return date(int(suffix[:4]), int(suffix[4:]), 1)


__all__ = [
    "collect_wordstat",
    "expand_semantics",
    "maintain_partitions",
    "partition_name",
    "poll_deferred_operations",
    "run_position_check",
    "schedule_project_runs",
]
