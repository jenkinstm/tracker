"""Съём позиций и сбор частотности: оценка стоимости, запуск, прогресс."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from app.config import settings
from app.db import SyncSessionMaker
from app.deps import ProjectDep, SessionDep, UserDep
from app.models import CheckRun, Keyword, Project, ProjectTarget
from app.providers.registry import provider_price_per_1000
from app.schemas import CostOut, RunIn, RunOut, WordstatEstimateIn, WordstatEstimateOut
from app.services import checks, wordstat
from app.services.cost import estimate_wordstat
from app.services.usage import month_start, month_totals
from app.tasks.jobs import collect_wordstat, run_position_check

router = APIRouter(prefix="/api/projects/{project_id}", tags=["runs"])


async def _target(session, project: Project, target_id: uuid.UUID | None) -> ProjectTarget:
    query = select(ProjectTarget).where(ProjectTarget.project_id == project.id)
    if target_id:
        query = query.where(ProjectTarget.id == target_id)
    target = (
        await session.execute(query.order_by(ProjectTarget.sort_order))
    ).scalars().first()
    if target is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "У проекта нет цели проверки")
    return target


async def _guard_budget(session, user) -> None:
    requests, cost = await month_totals(session, user.id, month_start())
    if requests >= user.monthly_request_limit or cost >= user.monthly_budget_kopecks:
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            "Месячный лимит расхода исчерпан. Новые задачи не стартуют.",
        )


@router.get("/runs/estimate", response_model=CostOut)
async def estimate(
    project: ProjectDep, session: SessionDep, target_id: uuid.UUID | None = None
) -> CostOut:
    """Расчёт показывается пользователю до запуска и пишется в лог по факту."""
    target = await _target(session, project, target_id)
    with SyncSessionMaker() as sync:
        data = checks.estimate_run(sync, project, target, "manual")
    return CostOut(**data)


@router.post("/runs", response_model=RunOut, status_code=status.HTTP_202_ACCEPTED)
async def start_run(
    project: ProjectDep, payload: RunIn, session: SessionDep, user: UserDep
) -> RunOut:
    await _guard_budget(session, user)
    target = await _target(session, project, payload.target_id)

    total = (
        await session.execute(
            select(func.count())
            .select_from(Keyword)
            .where(Keyword.project_id == project.id, Keyword.is_active.is_(True))
        )
    ).scalar_one()
    if not total:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "В проекте нет активных фраз")

    today = datetime.now(UTC).date()
    existing = (
        await session.execute(
            select(CheckRun).where(
                CheckRun.project_id == project.id,
                CheckRun.target_id == target.id,
                CheckRun.scheduled_for == today,
            )
        )
    ).scalar_one_or_none()
    if existing is not None and existing.status in ("queued", "running") and not payload.force:
        # Идемпотентность: второй клик по кнопке не создаёт второй съём и не тратит деньги.
        return RunOut.model_validate(existing)

    with SyncSessionMaker() as sync:
        sync_project = sync.get(Project, project.id)
        sync_target = sync.get(ProjectTarget, target.id)
        run = checks.create_run(
            sync,
            project=sync_project,
            target=sync_target,
            scheduled_for=today,
            trigger="manual",
            keywords_total=int(total),
        )
        sync.commit()
        run_id = run.id
        payload_out = RunOut.model_validate(run)

    run_position_check.delay(str(run_id))
    return payload_out


@router.get("/runs", response_model=list[RunOut])
async def list_runs(project: ProjectDep, session: SessionDep, limit: int = 20) -> list[CheckRun]:
    return list(
        (
            await session.execute(
                select(CheckRun)
                .where(CheckRun.project_id == project.id)
                .order_by(CheckRun.scheduled_for.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )


@router.get("/runs/{run_id}", response_model=RunOut)
async def get_run(project: ProjectDep, run_id: uuid.UUID, session: SessionDep) -> CheckRun:
    run = (
        await session.execute(
            select(CheckRun).where(CheckRun.id == run_id, CheckRun.project_id == project.id)
        )
    ).scalar_one_or_none()
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Съём не найден")
    return run


@router.post("/wordstat/estimate", response_model=WordstatEstimateOut)
async def wordstat_estimate(
    project: ProjectDep, payload: WordstatEstimateIn, session: SessionDep
) -> WordstatEstimateOut:
    """Частотность — самая дорогая операция, поэтому оценку показываем всегда."""
    with SyncSessionMaker() as sync:
        selected, skipped = wordstat.select_keywords(
            sync, project.id, keyword_ids=payload.keyword_ids, only_missing=payload.only_missing
        )
    estimate = estimate_wordstat(
        len(selected), price_per_1000_kopecks=provider_price_per_1000("wordstat_top")
    )
    return WordstatEstimateOut(
        **estimate.as_dict(),
        total_selected=len(selected) + skipped,
        fresh_skipped=skipped,
    )


@router.post("/wordstat/collect", response_model=dict, status_code=status.HTTP_202_ACCEPTED)
async def wordstat_collect(
    project: ProjectDep, payload: WordstatEstimateIn, session: SessionDep, user: UserDep
) -> dict:
    await _guard_budget(session, user)
    task = collect_wordstat.delay(
        str(project.id),
        [str(k) for k in payload.keyword_ids] if payload.keyword_ids else None,
        payload.only_missing,
    )
    return {
        "task_id": task.id,
        "fresh_days": settings.wordstat_fresh_days,
        "message": "Сбор частотности поставлен в очередь",
    }
