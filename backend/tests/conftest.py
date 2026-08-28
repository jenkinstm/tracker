"""Фикстуры интеграционных тестов.

Тесты работают на отдельной базе rankpulse_test. Если Postgres недоступен, модуль
пропускается: юнит-тесты ядра и провайдеров от БД не зависят и гоняются всегда.
"""

from __future__ import annotations

import os
import uuid
from datetime import time

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

ADMIN_URL = os.getenv(
    "TEST_ADMIN_URL", "postgresql+psycopg://rankpulse:rankpulse@localhost:5432/postgres"
)
TEST_DB = os.getenv("TEST_DB_NAME", "rankpulse_test")
TEST_URL = ADMIN_URL.rsplit("/", 1)[0] + f"/{TEST_DB}"


def _postgres_available() -> bool:
    try:
        engine = create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
        with engine.connect():
            return True
    except Exception:  # noqa: BLE001
        return False


requires_db = pytest.mark.skipif(not _postgres_available(), reason="Postgres недоступен")


@pytest.fixture(scope="session")
def db_engine():
    if not _postgres_available():
        pytest.skip("Postgres недоступен")

    admin = create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)"))
        conn.execute(text(f"CREATE DATABASE {TEST_DB}"))
    admin.dispose()

    os.environ["DATABASE_URL"] = TEST_URL.replace("+psycopg", "+asyncpg")

    from alembic.config import Config

    from alembic import command

    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", TEST_URL)
    command.upgrade(config, "head")

    engine = create_engine(TEST_URL, future=True)
    yield engine
    engine.dispose()


@pytest.fixture
def session(db_engine):
    maker = sessionmaker(db_engine, expire_on_commit=False)
    with maker() as session:
        yield session
        session.rollback()


@pytest.fixture
def demo(session):
    """Пользователь, проект на example.com и цель проверки Яндекс/Москва/ТОП-100."""
    from app.models import Project, ProjectTarget, User
    from app.security import hash_password

    user = User(
        email=f"test-{uuid.uuid4().hex[:8]}@rankpulse.ru",
        hashed_password=hash_password("test-password"),
    )
    session.add(user)
    session.flush()

    project = Project(
        user_id=user.id,
        name="Тест",
        domain="example.com",
        schedule="manual",
        schedule_time=time(8, 0),
    )
    session.add(project)
    session.flush()

    target = ProjectTarget(project_id=project.id, engine="yandex", region_code="213", depth=100)
    session.add(target)
    session.commit()
    return user, project, target
