"""Проекты, цели проверки и группы фраз."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import delete, func, select

from app.deps import ProjectDep, SessionDep, UserDep
from app.models import CheckRun, Keyword, KeywordGroup, Project, ProjectTarget
from app.schemas import (
    GroupIn,
    GroupOut,
    ProjectDetail,
    ProjectIn,
    ProjectOut,
    ProjectPatch,
    RunOut,
    TargetIn,
    TargetOut,
)

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _detail(
    project: Project,
    targets: list[ProjectTarget],
    keywords_count: int,
    last_run: CheckRun | None,
) -> ProjectDetail:
    """Собираем ответ явно: model_validate дёрнул бы ленивую связь и упал бы в async-сессии."""
    return ProjectDetail(
        **ProjectOut.model_validate(project).model_dump(),
        targets=[TargetOut.model_validate(t) for t in targets],
        keywords_count=keywords_count,
        last_run=RunOut.model_validate(last_run) if last_run else None,
    )


@router.get("", response_model=list[ProjectDetail])
async def list_projects(session: SessionDep, user: UserDep) -> list[ProjectDetail]:
    projects = list(
        (
            await session.execute(
                select(Project)
                .where(Project.user_id == user.id)
                .order_by(Project.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    counts = dict(
        (
            await session.execute(
                select(Keyword.project_id, func.count())
                .where(Keyword.project_id.in_([p.id for p in projects] or [uuid.uuid4()]))
                .group_by(Keyword.project_id)
            )
        ).all()
    )

    result: list[ProjectDetail] = []
    for project in projects:
        targets = list(
            (
                await session.execute(
                    select(ProjectTarget)
                    .where(ProjectTarget.project_id == project.id)
                    .order_by(ProjectTarget.sort_order)
                )
            )
            .scalars()
            .all()
        )
        last_run = (
            await session.execute(
                select(CheckRun)
                .where(CheckRun.project_id == project.id)
                .order_by(CheckRun.scheduled_for.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        result.append(
            _detail(
                project,
                targets,
                counts.get(project.id, 0),
                last_run,
            )
        )
    return result


@router.post("", response_model=ProjectDetail, status_code=status.HTTP_201_CREATED)
async def create_project(payload: ProjectIn, session: SessionDep, user: UserDep) -> ProjectDetail:
    project = Project(
        user_id=user.id,
        name=payload.name,
        domain=payload.domain,
        match_subdomains=payload.match_subdomains,
        fix_typos=payload.fix_typos,
        schedule=payload.schedule,
        schedule_time=payload.schedule_time,
        timezone=payload.timezone,
    )
    session.add(project)
    await session.flush()

    # В MVP цель одна: Яндекс, один регион, десктоп, глубина 100.
    target = ProjectTarget(
        project_id=project.id, engine="yandex", region_code=payload.region_code, depth=100
    )
    session.add(target)
    await session.commit()

    return _detail(project, [target], 0, None)


@router.get("/{project_id}", response_model=ProjectDetail)
async def get_project(project: ProjectDep, session: SessionDep) -> ProjectDetail:
    targets = list(
        (
            await session.execute(
                select(ProjectTarget)
                .where(ProjectTarget.project_id == project.id)
                .order_by(ProjectTarget.sort_order)
            )
        )
        .scalars()
        .all()
    )
    count = (
        await session.execute(
            select(func.count()).select_from(Keyword).where(Keyword.project_id == project.id)
        )
    ).scalar_one()
    last_run = (
        await session.execute(
            select(CheckRun)
            .where(CheckRun.project_id == project.id)
            .order_by(CheckRun.scheduled_for.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    return _detail(project, targets, int(count), last_run)


@router.patch("/{project_id}", response_model=ProjectOut)
async def update_project(
    project: ProjectDep, payload: ProjectPatch, session: SessionDep
) -> Project:
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(project, field, value)
    await session.commit()
    return project


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(project: ProjectDep, session: SessionDep) -> None:
    await session.delete(project)
    await session.commit()


@router.post("/{project_id}/targets", response_model=TargetOut, status_code=201)
async def add_target(project: ProjectDep, payload: TargetIn, session: SessionDep) -> ProjectTarget:
    exists = (
        await session.execute(
            select(ProjectTarget).where(
                ProjectTarget.project_id == project.id,
                ProjectTarget.engine == payload.engine,
                ProjectTarget.region_code == payload.region_code,
                ProjectTarget.device == payload.device,
            )
        )
    ).scalar_one_or_none()
    if exists is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Такая цель проверки уже есть")

    target = ProjectTarget(project_id=project.id, **payload.model_dump())
    session.add(target)
    await session.commit()
    return target


@router.get("/{project_id}/groups", response_model=list[GroupOut])
async def list_groups(project: ProjectDep, session: SessionDep) -> list[GroupOut]:
    rows = (
        await session.execute(
            select(KeywordGroup, func.count(Keyword.id))
            .outerjoin(Keyword, Keyword.group_id == KeywordGroup.id)
            .where(KeywordGroup.project_id == project.id)
            .group_by(KeywordGroup.id)
            .order_by(KeywordGroup.sort_order, KeywordGroup.name)
        )
    ).all()
    groups = []
    for group, count in rows:
        item = GroupOut.model_validate(group)
        item.keywords_count = int(count)
        groups.append(item)
    return groups


@router.post("/{project_id}/groups", response_model=GroupOut, status_code=201)
async def create_group(project: ProjectDep, payload: GroupIn, session: SessionDep) -> KeywordGroup:
    group = KeywordGroup(project_id=project.id, name=payload.name, parent_id=payload.parent_id)
    session.add(group)
    await session.commit()
    return group


@router.delete("/{project_id}/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(project: ProjectDep, group_id: uuid.UUID, session: SessionDep) -> None:
    await session.execute(
        delete(KeywordGroup).where(
            KeywordGroup.id == group_id, KeywordGroup.project_id == project.id
        )
    )
    await session.commit()
