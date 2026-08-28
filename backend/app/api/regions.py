"""Справочник регионов Яндекса. Тянем один раз, а не на каждый запрос."""

from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import select

from app.deps import SessionDep, UserDep
from app.models import Region
from app.providers.registry import get_wordstat_provider
from app.schemas import RegionOut

router = APIRouter(prefix="/api/regions", tags=["regions"])


@router.get("", response_model=list[RegionOut])
async def list_regions(session: SessionDep, q: str = "", limit: int = 50) -> list[Region]:
    query = select(Region).order_by(Region.name).limit(limit)
    if q:
        query = query.where(Region.name.ilike(f"%{q}%"))
    return list((await session.execute(query)).scalars().all())


@router.post("/refresh", response_model=dict)
async def refresh_regions(session: SessionDep, user: UserDep) -> dict:
    provider = get_wordstat_provider()
    rows = provider.regions_tree()
    for row in rows:
        existing = await session.get(Region, row["code"])
        if existing is None:
            session.add(
                Region(code=row["code"], name=row["name"], parent_code=row.get("parent_code"))
            )
        else:
            existing.name = row["name"]
            existing.parent_code = row.get("parent_code")
    await session.commit()
    return {"updated": len(rows)}
