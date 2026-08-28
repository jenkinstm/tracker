"""Подключения к БД: асинхронное для API, синхронное для Celery и Alembic."""

from collections.abc import AsyncIterator, Iterator

from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings

async_engine = create_async_engine(settings.database_url, pool_pre_ping=True, future=True)
AsyncSessionMaker = async_sessionmaker(async_engine, expire_on_commit=False)

sync_engine = create_engine(settings.sync_database_url, pool_pre_ping=True, future=True)
SyncSessionMaker = sessionmaker(sync_engine, expire_on_commit=False, class_=Session)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with AsyncSessionMaker() as session:
        yield session


def sync_session() -> Iterator[Session]:
    with SyncSessionMaker() as session:
        yield session
