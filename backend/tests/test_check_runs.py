"""Интеграционные тесты съёма позиций. Провайдер замокан, наружу никто не ходит."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import func, select, text

from app.models import CheckRun, DeferredOperation, Keyword, Position, SerpSnapshot
from app.providers.base import ProviderError
from app.providers.mock import MockProvider
from app.services import checks
from app.services.text import normalize_phrase

pytestmark = pytest.mark.usefixtures("db_engine")


def add_keywords(session, project, count: int) -> list[Keyword]:
    keywords = []
    for i in range(count):
        phrase = f"тестовая фраза {i}"
        keyword = Keyword(
            project_id=project.id,
            phrase=phrase,
            phrase_normalized=normalize_phrase(phrase),
        )
        session.add(keyword)
        keywords.append(keyword)
    session.commit()
    return keywords


class FlakyProvider(MockProvider):
    """Каждый n-й запрос падает: проверяем, что одна фраза не роняет весь съём."""

    def __init__(self, *args, fail_every: int = 10, **kwargs):
        super().__init__(*args, **kwargs)
        self.fail_every = fail_every
        self.calls = 0

    def search(self, query: str, **kwargs) -> list[dict]:
        self.calls += 1
        if self.calls % self.fail_every == 0:
            raise ProviderError("Временная ошибка провайдера")
        return super().search(query, **kwargs)


def test_run_is_idempotent_for_the_same_date(session, demo):
    _, project, target = demo
    add_keywords(session, project, 3)
    day = date(2026, 8, 20)

    first = checks.create_run(session, project=project, target=target, scheduled_for=day)
    session.commit()
    second = checks.create_run(session, project=project, target=target, scheduled_for=day)
    session.commit()

    assert first.id == second.id
    total = session.execute(select(func.count()).select_from(CheckRun)).scalar_one()
    assert total == 1


def test_sync_run_stores_positions_and_snapshots(session, demo):
    _, project, target = demo
    keywords = add_keywords(session, project, 5)
    run = checks.create_run(
        session, project=project, target=target, scheduled_for=date(2026, 8, 21)
    )
    run.mode = "sync"
    session.commit()

    project_obj, target_obj, keyword_list = checks.start_run(session, run)
    checks.execute_sync(
        session, run, project_obj, target_obj, keyword_list, MockProvider(project.domain)
    )

    assert run.status == "done"
    assert run.keywords_done == len(keywords)
    positions = session.execute(select(func.count()).select_from(Position)).scalar_one()
    snapshots = session.execute(select(func.count()).select_from(SerpSnapshot)).scalar_one()
    assert positions == len(keywords)
    assert snapshots == len(keywords)


def test_failed_phrases_make_run_partial_and_do_not_block_the_rest(session, demo):
    _, project, target = demo
    add_keywords(session, project, 20)
    run = checks.create_run(
        session, project=project, target=target, scheduled_for=date(2026, 8, 22)
    )
    run.mode = "sync"
    session.commit()

    project_obj, target_obj, keywords = checks.start_run(session, run)
    checks.execute_sync(
        session,
        run,
        project_obj,
        target_obj,
        keywords,
        FlakyProvider(project.domain, fail_every=10),
    )

    assert run.status == "partial"
    assert run.keywords_failed == 2
    assert run.keywords_done == 18


def test_sync_mode_is_forbidden_above_the_threshold(session, demo):
    from app.config import settings

    _, project, target = demo
    add_keywords(session, project, settings.sync_max_keywords + 1)
    run = checks.create_run(
        session, project=project, target=target, scheduled_for=date(2026, 8, 23)
    )
    run.mode = "sync"
    session.commit()

    project_obj, target_obj, keywords = checks.start_run(session, run)
    with pytest.raises(checks.RunRejected):
        checks.execute_sync(
            session, run, project_obj, target_obj, keywords, MockProvider(project.domain)
        )


def test_deferred_run_registers_operations_with_ttl(session, demo):
    _, project, target = demo
    keywords = add_keywords(session, project, 7)
    run = checks.create_run(
        session, project=project, target=target, scheduled_for=date(2026, 8, 24)
    )
    session.commit()

    project_obj, target_obj, keyword_list = checks.start_run(session, run)
    checks.execute_deferred(
        session, run, project_obj, target_obj, keyword_list, MockProvider(project.domain)
    )

    operations = list(session.execute(select(DeferredOperation)).scalars().all())
    assert len(operations) == len(keywords)
    assert run.keywords_pending == len(keywords)
    assert run.status == "running"
    lifetime = operations[0].expires_at - operations[0].submitted_at
    assert lifetime == timedelta(hours=12)


def test_poller_finishes_the_run_even_if_the_worker_is_gone(session, demo, monkeypatch):
    """Воркер убит после постановки операций — результаты всё равно забираются."""
    from app.tasks import jobs

    _, project, target = demo
    keywords = add_keywords(session, project, 4)
    run = checks.create_run(
        session, project=project, target=target, scheduled_for=date(2026, 8, 25)
    )
    session.commit()

    project_obj, target_obj, keyword_list = checks.start_run(session, run)
    checks.execute_deferred(
        session, run, project_obj, target_obj, keyword_list, MockProvider(project.domain)
    )
    run_id = run.id

    # Опрашивальщик не трогает операции моложе пяти минут — сдвигаем время постановки.
    session.execute(
        DeferredOperation.__table__.update()
        .where(DeferredOperation.check_run_id == run_id)
        .values(submitted_at=datetime.now(UTC) - timedelta(minutes=10))
    )
    session.commit()

    monkeypatch.setattr(jobs, "SyncSessionMaker", _session_factory(session))
    result = jobs.poll_deferred_operations()

    session.expire_all()
    refreshed = session.get(CheckRun, run_id)
    assert result["fetched"] == len(keywords)
    assert refreshed.status == "done"
    assert refreshed.keywords_pending == 0


def test_expired_operation_is_marked_and_resubmitted(session, demo, monkeypatch):
    """Просроченная операция — это оплаченные и выброшенные деньги, она должна быть видна."""
    from app.tasks import jobs

    _, project, target = demo
    add_keywords(session, project, 2)
    run = checks.create_run(
        session, project=project, target=target, scheduled_for=date(2026, 8, 26)
    )
    session.commit()

    project_obj, target_obj, keyword_list = checks.start_run(session, run)
    checks.execute_deferred(
        session, run, project_obj, target_obj, keyword_list, MockProvider(project.domain)
    )

    past = datetime.now(UTC) - timedelta(hours=13)
    session.execute(
        DeferredOperation.__table__.update()
        .where(DeferredOperation.check_run_id == run.id)
        .values(submitted_at=past, expires_at=past + timedelta(hours=12))
    )
    session.commit()

    monkeypatch.setattr(jobs, "SyncSessionMaker", _session_factory(session))
    result = jobs.poll_deferred_operations()

    assert result["expired"] == 2
    expired = list(
        session.execute(
            select(DeferredOperation).where(DeferredOperation.status == "expired")
        ).scalars().all()
    )
    resubmitted = list(
        session.execute(
            select(DeferredOperation).where(DeferredOperation.retry_of.is_not(None))
        ).scalars().all()
    )
    assert len(expired) == 2
    assert len(resubmitted) == 2


def test_rerun_for_the_same_date_updates_positions_instead_of_duplicating(session, demo):
    _, project, target = demo
    add_keywords(session, project, 3)
    day = date(2026, 8, 27)

    for _ in range(2):
        run = checks.create_run(
        session, project=project, target=target, scheduled_for=day
    )
        run.mode = "sync"
        session.commit()
        project_obj, target_obj, keywords = checks.start_run(session, run)
        checks.execute_sync(
            session, run, project_obj, target_obj, keywords, MockProvider(project.domain)
        )

    positions = session.execute(
        select(func.count()).select_from(Position).where(Position.checked_on == day)
    ).scalar_one()
    assert positions == 3


def test_position_goes_into_the_right_monthly_partition(session, demo):
    """Вставка за следующий месяц должна попасть в свою партицию, а не упасть."""
    from app.services.partitions import partition_name

    _, project, target = demo
    add_keywords(session, project, 1)
    future = date.today().replace(day=1) + timedelta(days=62)
    run = checks.create_run(session, project=project, target=target, scheduled_for=future)
    run.mode = "sync"
    session.commit()

    project_obj, target_obj, keywords = checks.start_run(session, run)
    checks.execute_sync(
        session, run, project_obj, target_obj, keywords, MockProvider(project.domain)
    )

    name = partition_name("positions", future)
    in_partition = session.execute(text(f"SELECT count(*) FROM {name}")).scalar_one()
    total = session.execute(
        select(func.count()).select_from(Position).where(Position.checked_on == future)
    ).scalar_one()
    assert total == 1
    assert in_partition == 1


def _session_factory(session):
    class _Maker:
        def __call__(self):
            return _Ctx(session)

    class _Ctx:
        def __init__(self, inner):
            self.inner = inner

        def __enter__(self):
            return self.inner

        def __exit__(self, *args):
            return False

    return _Maker()


def test_run_without_keywords_fails_fast(session, demo):
    _, project, target = demo
    run = checks.create_run(
        session, project=project, target=target, scheduled_for=date(2026, 8, 28)
    )
    session.commit()
    with pytest.raises(checks.RunRejected):
        checks.start_run(session, run)
    assert run.status == "failed"


def test_unknown_run_is_rejected(session):
    with pytest.raises(checks.RunRejected):
        checks.run_check(session, uuid.uuid4())
