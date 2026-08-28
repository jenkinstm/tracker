"""Отчёт по позициям, видимость, сводка и экспорт."""

from __future__ import annotations

import csv
import io
import uuid
from datetime import date

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select

from app.deps import ProjectDep, SessionDep
from app.models import ProjectTarget
from app.schemas import ReportOut, ReportRow, SummaryOut, VisibilityPoint
from app.services import reports

router = APIRouter(prefix="/api/projects/{project_id}", tags=["reports"])

EXPORT_HEADERS = [
    "Фраза",
    "Группа",
    "Частотность (широкая)",
    "Позиция",
    "Прошлый съём",
    "Дельта",
    "Ранжируемый URL",
    "Целевой URL",
    "Расхождение URL",
]


async def _target(session, project, target_id: uuid.UUID | None) -> ProjectTarget:
    query = select(ProjectTarget).where(ProjectTarget.project_id == project.id)
    if target_id:
        query = query.where(ProjectTarget.id == target_id)
    target = (await session.execute(query.order_by(ProjectTarget.sort_order))).scalars().first()
    if target is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "У проекта нет цели проверки")
    return target


async def _collect(
    session,
    project,
    target: ProjectTarget,
    *,
    on: date | None,
    group_id: uuid.UUID | None,
    q: str,
    change: str | None,
    page: int,
    size: int,
) -> tuple[list[dict], int, date | None, date | None]:
    checked_on = await reports.latest_check_date(session, project.id, target.id, on)
    items, total, previous = await reports.report_rows(
        session,
        project_id=project.id,
        target_id=target.id,
        checked_on=checked_on,
        group_id=group_id,
        query=q or None,
        change=change,
        page=page,
        size=size,
    )
    return items, total, checked_on, previous


@router.get("/report", response_model=ReportOut)
async def report(
    project: ProjectDep,
    session: SessionDep,
    target_id: uuid.UUID | None = None,
    on: date | None = None,
    group_id: uuid.UUID | None = None,
    q: str = "",
    change: str | None = Query(None, pattern="^(up|down|top3|top10|lost)$"),
    page: int = Query(1, ge=1),
    size: int = Query(100, ge=1, le=1000),
) -> ReportOut:
    target = await _target(session, project, target_id)
    items, total, checked_on, previous = await _collect(
        session, project, target, on=on, group_id=group_id, q=q, change=change, page=page, size=size
    )
    return ReportOut(
        items=[ReportRow(**row) for row in items],
        total=total,
        page=page,
        size=size,
        checked_on=checked_on,
        previous_checked_on=previous,
        depth=target.depth,
    )


@router.get("/summary", response_model=SummaryOut)
async def summary(
    project: ProjectDep,
    session: SessionDep,
    target_id: uuid.UUID | None = None,
    on: date | None = None,
) -> SummaryOut:
    target = await _target(session, project, target_id)
    checked_on = await reports.latest_check_date(session, project.id, target.id, on)
    return SummaryOut(
        **await reports.summary(
            session, project_id=project.id, target_id=target.id, checked_on=checked_on
        )
    )


@router.get("/visibility", response_model=list[VisibilityPoint])
async def visibility(
    project: ProjectDep, session: SessionDep, target_id: uuid.UUID | None = None, limit: int = 60
) -> list[VisibilityPoint]:
    target = await _target(session, project, target_id)
    points = await reports.visibility(
        session, project_id=project.id, target_id=target.id, limit=limit
    )
    return [VisibilityPoint(**point) for point in points]


def _export_rows(items: list[dict], depth: int) -> list[list]:
    rows = []
    for row in items:
        rows.append(
            [
                row["phrase"],
                row["group_name"] or "",
                row["freq_base"] if row["freq_base"] is not None else "",
                row["position"] if row["position"] is not None else f">{depth}",
                row["previous_position"] if row["previous_position"] is not None else "",
                row["delta"] if row["delta"] is not None else "",
                row["url"] or "",
                row["target_url"] or "",
                "да" if row["url_mismatch"] else "",
            ]
        )
    return rows


@router.get("/export.csv")
async def export_csv(
    project: ProjectDep,
    session: SessionDep,
    target_id: uuid.UUID | None = None,
    on: date | None = None,
    group_id: uuid.UUID | None = None,
    q: str = "",
    change: str | None = None,
) -> Response:
    target = await _target(session, project, target_id)
    items, _, checked_on, _ = await _collect(
        session, project, target, on=on, group_id=group_id, q=q, change=change, page=1, size=100000
    )

    buffer = io.StringIO()
    # Разделитель «;» и BOM: иначе Excel в русской локали открывает файл одной колонкой.
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(EXPORT_HEADERS)
    writer.writerows(_export_rows(items, target.depth))

    body = "﻿" + buffer.getvalue()
    name = f"rankpulse-{project.domain}-{checked_on or 'нет-данных'}.csv"
    return Response(
        content=body.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{_ascii_name(name)}"'},
    )


@router.get("/export.xlsx")
async def export_xlsx(
    project: ProjectDep,
    session: SessionDep,
    target_id: uuid.UUID | None = None,
    on: date | None = None,
    group_id: uuid.UUID | None = None,
    q: str = "",
    change: str | None = None,
) -> Response:
    from openpyxl import Workbook
    from openpyxl.styles import Font

    target = await _target(session, project, target_id)
    items, _, checked_on, _ = await _collect(
        session, project, target, on=on, group_id=group_id, q=q, change=change, page=1, size=100000
    )

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Позиции"
    sheet.append(EXPORT_HEADERS)
    for cell in sheet[1]:
        cell.font = Font(bold=True)
    for row in _export_rows(items, target.depth):
        sheet.append(row)
    sheet.freeze_panes = "A2"
    for column, width in zip("ABCDEFGHI", (46, 20, 16, 10, 14, 9, 46, 46, 14), strict=False):
        sheet.column_dimensions[column].width = width

    stream = io.BytesIO()
    workbook.save(stream)
    name = f"rankpulse-{project.domain}-{checked_on or 'нет-данных'}.xlsx"
    return Response(
        content=stream.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{_ascii_name(name)}"'},
    )


def _ascii_name(name: str) -> str:
    return name.encode("ascii", errors="ignore").decode("ascii") or "rankpulse-export"
