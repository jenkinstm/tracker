"""Модели по docs/DATA-MODEL.md.

Денежные значения — целые копейки в BIGINT. Все временные метки — TIMESTAMPTZ в UTC.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = _uuid_pk()
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    monthly_request_limit: Mapped[int] = mapped_column(Integer, default=100_000, nullable=False)
    monthly_budget_kopecks: Mapped[int] = mapped_column(BigInteger, default=500_000, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    projects: Mapped[list[Project]] = relationship(back_populates="user", cascade="all, delete")


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # Нормализованный хост: без схемы, без www., в нижнем регистре, в punycode.
    domain: Mapped[str] = mapped_column(String(253), nullable=False)
    match_subdomains: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    fix_typos: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    schedule: Mapped[str] = mapped_column(String(16), default="manual", nullable=False)
    schedule_time: Mapped[time] = mapped_column(Time, default=time(8, 0), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), default="Europe/Moscow", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(back_populates="projects")
    targets: Mapped[list[ProjectTarget]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class ProjectTarget(Base):
    """Цель проверки: ПС + регион + устройство + глубина.

    Отдельная таблица, а не поля в projects: глубина и тип выдачи — настройки региона
    внутри поисковой системы, а регионов в проекте может быть много.
    """

    __tablename__ = "project_targets"
    __table_args__ = (
        UniqueConstraint(
            "project_id", "engine", "region_code", "device", name="uq_target_project_engine_region"
        ),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    engine: Mapped[str] = mapped_column(String(16), default="yandex", nullable=False)
    region_code: Mapped[str] = mapped_column(String(16), nullable=False)
    device: Mapped[str] = mapped_column(String(16), default="desktop", nullable=False)
    depth: Mapped[int] = mapped_column(SmallInteger, default=100, nullable=False)
    lang: Mapped[str | None] = mapped_column(String(8), nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(SmallInteger, default=0, nullable=False)

    project: Mapped[Project] = relationship(back_populates="targets")


class KeywordGroup(Base):
    __tablename__ = "keyword_groups"

    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("keyword_groups.id", ondelete="SET NULL"), nullable=True
    )
    sort_order: Mapped[int] = mapped_column(SmallInteger, default=0, nullable=False)


class Keyword(Base):
    __tablename__ = "keywords"
    __table_args__ = (
        UniqueConstraint("project_id", "phrase_normalized", name="uq_keyword_project_normalized"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    group_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("keyword_groups.id", ondelete="SET NULL"), nullable=True, index=True
    )
    phrase: Mapped[str] = mapped_column(Text, nullable=False)
    phrase_normalized: Mapped[str] = mapped_column(Text, nullable=False)
    # Страница, которая должна ранжироваться по мнению оптимизатора.
    target_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class WordstatSnapshot(Base):
    __tablename__ = "wordstat_snapshots"
    __table_args__ = (Index("ix_wordstat_keyword_collected", "keyword_id", "collected_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    keyword_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("keywords.id", ondelete="CASCADE"), nullable=False
    )
    region_yandex: Mapped[int | None] = mapped_column(Integer, nullable=True)
    freq_base: Mapped[int] = mapped_column(Integer, nullable=False)
    # Search API операторы не поддерживает: заполняется только сторонним провайдером.
    freq_exact: Mapped[int | None] = mapped_column(Integer, nullable=True)
    freq_exact_form: Mapped[int | None] = mapped_column(Integer, nullable=True)
    device: Mapped[str] = mapped_column(String(16), default="all", nullable=False)
    collected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(32), nullable=False)


class WordstatAssociation(Base):
    __tablename__ = "wordstat_associations"
    __table_args__ = (Index("ix_association_keyword", "keyword_id", "is_dismissed"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    keyword_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("keywords.id", ondelete="CASCADE"), nullable=False
    )
    phrase: Mapped[str] = mapped_column(Text, nullable=False)
    count: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    is_dismissed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    collected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class CheckRun(Base):
    __tablename__ = "check_runs"
    __table_args__ = (
        # Идемпотентность: повторный запуск за ту же дату не создаёт второй съём.
        UniqueConstraint("project_id", "target_id", "scheduled_for", name="uq_run_project_date"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("project_targets.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(16), default="queued", nullable=False)
    scheduled_for: Mapped[date] = mapped_column(Date, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    keywords_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    keywords_done: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    keywords_pending: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    keywords_failed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cost_kopecks: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    trigger: Mapped[str] = mapped_column(String(16), default="manual", nullable=False)
    mode: Mapped[str] = mapped_column(String(16), default="deferred", nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class Position(Base):
    """Партиционируется помесячно по checked_on. Ключ партиции входит в PK и уникальность."""

    __tablename__ = "positions"
    __table_args__ = (
        UniqueConstraint("keyword_id", "target_id", "checked_on", name="uq_position_keyword_date"),
        Index("ix_position_keyword_date", "keyword_id", "checked_on"),
        Index("ix_position_run", "check_run_id"),
        {"postgresql_partition_by": "RANGE (checked_on)"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    checked_on: Mapped[date] = mapped_column(Date, primary_key=True, nullable=False)
    check_run_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    keyword_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    # null = домена нет в выдаче на заданной глубине, в отчёте «>N».
    position: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    device: Mapped[str] = mapped_column(String(16), default="desktop", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class SerpSnapshot(Base):
    """Сырой ТОП-100. Партиционируется помесячно, партиции старше 90 дней удаляются."""

    __tablename__ = "serp_snapshots"
    __table_args__ = (
        UniqueConstraint("keyword_id", "target_id", "checked_on", name="uq_serp_keyword_date"),
        Index("ix_serp_run", "check_run_id"),
        {"postgresql_partition_by": "RANGE (checked_on)"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    checked_on: Mapped[date] = mapped_column(Date, primary_key=True, nullable=False)
    check_run_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    keyword_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    results: Mapped[list[dict]] = mapped_column(JSONB, nullable=False)


class DeferredOperation(Base):
    """Отложенная операция Search API. Результат живёт 12 часов, потом деньги потеряны."""

    __tablename__ = "deferred_operations"
    __table_args__ = (Index("ix_deferred_status_expires", "status", "expires_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    operation_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    check_run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("check_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    keyword_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("keywords.id", ondelete="CASCADE"), nullable=False
    )
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    poll_attempts: Mapped[int] = mapped_column(SmallInteger, default=0, nullable=False)
    last_polled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cost_kopecks: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    retry_of: Mapped[str | None] = mapped_column(String(128), nullable=True)


class Region(Base):
    """Справочник lr Яндекса. GetRegionsTree — единственный бесплатный метод Вордстата."""

    __tablename__ = "regions"

    code: Mapped[str] = mapped_column(String(16), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    parent_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ApiUsageLog(Base):
    """Источник правды для экрана расходов и для лимитов."""

    __tablename__ = "api_usage_log"
    __table_args__ = (Index("ix_usage_user_created", "user_id", "created_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    operation: Mapped[str] = mapped_column(String(32), nullable=False)
    requests: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    cost_kopecks: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="ok", nullable=False)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ProviderSetting(Base):
    """Цена за 1000 хранится в БД: тарифы меняются, пользователь правит их сам."""

    __tablename__ = "provider_settings"
    __table_args__ = (UniqueConstraint("user_id", "provider", name="uq_provider_user"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    credentials: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    price_per_1000_kopecks: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    priority: Mapped[int] = mapped_column(SmallInteger, default=0, nullable=False)
