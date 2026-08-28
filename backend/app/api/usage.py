"""Экран контроля расхода: сколько запросов и на какую сумму ушло за месяц."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter

from app.deps import SessionDep, UserDep
from app.schemas import UsageOut, UsageRow
from app.services.usage import month_start, month_totals, usage_breakdown

router = APIRouter(prefix="/api/usage", tags=["usage"])


@router.get("", response_model=UsageOut)
async def usage(session: SessionDep, user: UserDep, month: str = "") -> UsageOut:
    since = date.fromisoformat(f"{month}-01") if month else month_start()
    requests, cost = await month_totals(session, user.id, since)
    breakdown = await usage_breakdown(session, user.id, since)

    return UsageOut(
        month=since.strftime("%Y-%m"),
        requests=requests,
        cost_kopecks=cost,
        cost_rubles=round(cost / 100, 2),
        request_limit=user.monthly_request_limit,
        budget_kopecks=user.monthly_budget_kopecks,
        limit_reached=requests >= user.monthly_request_limit
        or cost >= user.monthly_budget_kopecks,
        by_operation=[
            UsageRow(
                provider=row["provider"],
                operation=row["operation"],
                requests=int(row["requests"]),
                cost_kopecks=int(row["cost_kopecks"]),
            )
            for row in breakdown["by_operation"]
        ],
        by_project=[
            {
                "project_id": row["project_id"],
                "name": row["name"],
                "requests": int(row["requests"]),
                "cost_kopecks": int(row["cost_kopecks"]),
            }
            for row in breakdown["by_project"]
        ],
    )
