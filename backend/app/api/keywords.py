"""Фразы: список, импорт из текста и файла, правка, удаление."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.deps import ProjectDep, SessionDep
from app.models import Keyword, KeywordGroup, WordstatSnapshot
from app.schemas import ImportIn, ImportReport, KeywordOut, KeywordPatch, Page
from app.services.importer import ParsedPhrases, parse_text, parse_upload

router = APIRouter(prefix="/api/projects/{project_id}/keywords", tags=["keywords"])

MAX_IMPORT_BYTES = 10 * 1024 * 1024


@router.get("", response_model=Page[KeywordOut])
async def list_keywords(
    project: ProjectDep,
    session: SessionDep,
    page: int = Query(1, ge=1),
    size: int = Query(100, ge=1, le=1000),
    group_id: uuid.UUID | None = None,
    q: str = "",
) -> Page[KeywordOut]:
    # Последний снимок частотности на фразу — DISTINCT ON, а не подзапрос на строку.
    latest_freq = (
        select(
            WordstatSnapshot.keyword_id,
            WordstatSnapshot.freq_base,
            WordstatSnapshot.collected_at,
        )
        .distinct(WordstatSnapshot.keyword_id)
        .order_by(WordstatSnapshot.keyword_id, WordstatSnapshot.collected_at.desc())
        .subquery()
    )

    conditions = [Keyword.project_id == project.id]
    if group_id:
        conditions.append(Keyword.group_id == group_id)
    if q:
        conditions.append(Keyword.phrase_normalized.like(f"%{q.lower()}%"))

    total = (
        await session.execute(select(func.count()).select_from(Keyword).where(*conditions))
    ).scalar_one()

    rows = (
        await session.execute(
            select(
                Keyword,
                KeywordGroup.name,
                latest_freq.c.freq_base,
                latest_freq.c.collected_at,
            )
            .outerjoin(KeywordGroup, KeywordGroup.id == Keyword.group_id)
            .outerjoin(latest_freq, latest_freq.c.keyword_id == Keyword.id)
            .where(*conditions)
            .order_by(Keyword.phrase)
            .limit(size)
            .offset((page - 1) * size)
        )
    ).all()

    items: list[KeywordOut] = []
    for keyword, group_name, freq_base, collected_at in rows:
        item = KeywordOut.model_validate(keyword)
        item.group_name = group_name
        item.freq_base = freq_base
        item.freq_collected_at = collected_at
        items.append(item)

    return Page[KeywordOut](items=items, total=int(total), page=page, size=size)


async def _store(
    session, project_id: uuid.UUID, parsed: ParsedPhrases, group_id: uuid.UUID | None
) -> ImportReport:
    added = 0
    if parsed.phrases:
        # ON CONFLICT DO NOTHING по (project_id, phrase_normalized): дубли внутри проекта
        # схлопываются на уровне БД, а не гонкой в приложении.
        statement = (
            pg_insert(Keyword)
            .values(
                [
                    {
                        "id": uuid.uuid4(),
                        "project_id": project_id,
                        "group_id": group_id,
                        "phrase": phrase,
                        "phrase_normalized": normalized,
                    }
                    for phrase, normalized in parsed.phrases
                ]
            )
            .on_conflict_do_nothing(constraint="uq_keyword_project_normalized")
            .returning(Keyword.id)
        )
        added = len((await session.execute(statement)).scalars().all())
        await session.commit()

    return ImportReport(
        total_lines=parsed.total_lines,
        added=added,
        duplicates_in_file=parsed.duplicates_in_file,
        duplicates_in_project=len(parsed.phrases) - added,
        empty=parsed.empty,
        too_long=parsed.too_long,
    )


@router.post("/import", response_model=ImportReport)
async def import_text(payload: ImportIn, project: ProjectDep, session: SessionDep) -> ImportReport:
    return await _store(session, project.id, parse_text(payload.text), payload.group_id)


@router.post("/import-file", response_model=ImportReport)
async def import_file(
    project: ProjectDep,
    session: SessionDep,
    file: UploadFile = File(...),
    group_id: str = Form(""),
) -> ImportReport:
    data = await file.read()
    if len(data) > MAX_IMPORT_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Файл больше 10 МБ")
    try:
        parsed = parse_upload(file.filename or "", data)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return await _store(
        session, project.id, parsed, uuid.UUID(group_id) if group_id else None
    )


@router.patch("/{keyword_id}", response_model=KeywordOut)
async def update_keyword(
    project: ProjectDep, keyword_id: uuid.UUID, payload: KeywordPatch, session: SessionDep
) -> KeywordOut:
    keyword = (
        await session.execute(
            select(Keyword).where(Keyword.id == keyword_id, Keyword.project_id == project.id)
        )
    ).scalar_one_or_none()
    if keyword is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Фраза не найдена")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(keyword, field, value)
    await session.commit()
    return KeywordOut.model_validate(keyword)


@router.post("/delete", response_model=dict)
async def delete_keywords(
    project: ProjectDep, session: SessionDep, keyword_ids: list[uuid.UUID]
) -> dict:
    result = await session.execute(
        delete(Keyword).where(Keyword.project_id == project.id, Keyword.id.in_(keyword_ids))
    )
    await session.commit()
    return {"deleted": result.rowcount or 0}
