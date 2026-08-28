"""Учёт расхода на внешние API. Источник правды для экрана расходов и для лимитов."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.models import ApiUsageLog, User


def month_start(day: date | None = None) -> date:
    day = day or datetime.now(UTC).date()
    return day.replace(day=1)


def log_usage(
    session: Session,
    *,
    user_id: uuid.UUID,
    project_id: uuid.UUID | None,
    provider: str,
    operation: str,
    requests: int,
    cost_kopecks: int,
    status: str = "ok",
    error_code: str | None = None,
) -> ApiUsageLog:
    entry = ApiUsageLog(
        user_id=user_id,
        project_id=project_id,
        provider=provider,
        operation=operation,
        requests=requests,
        cost_kopecks=cost_kopecks,
        status=status,
        error_code=error_code,
    )
    session.add(entry)
    return entry


def month_totals_sync(session: Session, user_id: uuid.UUID) -> tuple[int, int]:
    row = session.execute(
        text(
            "SELECT COALESCE(SUM(requests),0), COALESCE(SUM(cost_kopecks),0) "
            "FROM api_usage_log WHERE user_id = :uid AND created_at >= :since"
        ),
        {"uid": user_id, "since": month_start()},
    ).one()
    return int(row[0]), int(row[1])


def limit_reached_sync(session: Session, user: User) -> bool:
    """При превышении лимита новые задачи не стартуют — это защита от перерасхода."""
    requests, cost = month_totals_sync(session, user.id)
    return requests >= user.monthly_request_limit or cost >= user.monthly_budget_kopecks


async def month_totals(session: AsyncSession, user_id: uuid.UUID, since: date) -> tuple[int, int]:
    row = (
        await session.execute(
            text(
                "SELECT COALESCE(SUM(requests),0), COALESCE(SUM(cost_kopecks),0) "
                "FROM api_usage_log WHERE user_id = :uid AND created_at >= :since"
            ),
            {"uid": user_id, "since": since},
        )
    ).one()
    return int(row[0]), int(row[1])


async def usage_breakdown(session: AsyncSession, user_id: uuid.UUID, since: date) -> dict:
    by_operation = (
        (
            await session.execute(
                text(
                    "SELECT provider, operation, SUM(requests) AS requests, "
                    "SUM(cost_kopecks) AS cost_kopecks FROM api_usage_log "
                    "WHERE user_id = :uid AND created_at >= :since "
                    "GROUP BY provider, operation ORDER BY cost_kopecks DESC"
                ),
                {"uid": user_id, "since": since},
            )
        )
        .mappings()
        .all()
    )
    by_project = (
        (
            await session.execute(
                text(
                    "SELECT p.id AS project_id, p.name, SUM(u.requests) AS requests, "
                    "SUM(u.cost_kopecks) AS cost_kopecks FROM api_usage_log u "
                    "JOIN projects p ON p.id = u.project_id "
                    "WHERE u.user_id = :uid AND u.created_at >= :since "
                    "GROUP BY p.id, p.name ORDER BY cost_kopecks DESC"
                ),
                {"uid": user_id, "since": since},
            )
        )
        .mappings()
        .all()
    )
    return {
        "by_operation": [dict(row) for row in by_operation],
        "by_project": [
            {**dict(row), "project_id": str(row["project_id"])} for row in by_project
        ],
    }


async def get_user(session: AsyncSession, user_id: uuid.UUID) -> User | None:
    return (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
