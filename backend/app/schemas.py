"""Схемы Pydantic. Единственное место валидации входа API."""

from __future__ import annotations

import uuid
from datetime import date, datetime, time
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.services.serp_matching import normalize_domain


class Page[T](BaseModel):
    items: list[T]
    total: int
    page: int
    size: int


class Credentials(BaseModel):
    email: EmailStr
    password: Annotated[str, Field(min_length=8, max_length=128)]


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    monthly_request_limit: int
    monthly_budget_kopecks: int


class TargetIn(BaseModel):
    engine: Literal["yandex"] = "yandex"
    region_code: Annotated[str, Field(min_length=1, max_length=16)]
    device: Literal["desktop", "mobile"] = "desktop"
    depth: Annotated[int, Field(ge=10, le=250)] = 100
    lang: str | None = None

    @field_validator("depth")
    @classmethod
    def yandex_depth_is_fixed(cls, value: int, info) -> int:
        # Сотня приходит одним запросом; вторая сотня стоит отдельных денег без пользы.
        if info.data.get("engine", "yandex") == "yandex" and value != 100:
            raise ValueError("Для Яндекса глубина фиксирована на 100")
        return value


class TargetOut(TargetIn):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    is_enabled: bool


class ProjectIn(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=200)]
    domain: Annotated[str, Field(min_length=3, max_length=253)]
    region_code: Annotated[str, Field(min_length=1, max_length=16)] = "213"
    match_subdomains: bool = False
    fix_typos: bool = True
    schedule: Literal["manual", "weekly", "daily"] = "manual"
    schedule_time: time = time(8, 0)
    timezone: str = "Europe/Moscow"

    @field_validator("domain")
    @classmethod
    def normalize(cls, value: str) -> str:
        normalized = normalize_domain(value)
        if not normalized or "." not in normalized:
            raise ValueError("Домен указан неверно")
        return normalized


class ProjectPatch(BaseModel):
    name: str | None = None
    match_subdomains: bool | None = None
    fix_typos: bool | None = None
    schedule: Literal["manual", "weekly", "daily"] | None = None
    schedule_time: time | None = None
    is_active: bool | None = None


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    domain: str
    match_subdomains: bool
    fix_typos: bool
    schedule: str
    schedule_time: time
    timezone: str
    is_active: bool
    created_at: datetime


class ProjectDetail(ProjectOut):
    targets: list[TargetOut] = []
    keywords_count: int = 0
    last_run: RunOut | None = None


class GroupIn(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=200)]
    parent_id: uuid.UUID | None = None


class GroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    parent_id: uuid.UUID | None
    keywords_count: int = 0


class KeywordPatch(BaseModel):
    target_url: str | None = None
    group_id: uuid.UUID | None = None
    is_active: bool | None = None


class KeywordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    phrase: str
    group_id: uuid.UUID | None
    group_name: str | None = None
    target_url: str | None
    is_active: bool
    freq_base: int | None = None
    freq_collected_at: datetime | None = None


class ImportIn(BaseModel):
    text: str = ""
    group_id: uuid.UUID | None = None


class ImportReport(BaseModel):
    """Пользователь должен видеть, сколько фраз добавлено и сколько отброшено и почему."""

    total_lines: int
    added: int
    duplicates_in_file: int
    duplicates_in_project: int
    empty: int
    too_long: int


class CostOut(BaseModel):
    keywords: int
    requests: int
    mode: str
    cost_kopecks: int
    cost_rubles: float


class WordstatEstimateIn(BaseModel):
    keyword_ids: list[uuid.UUID] | None = None
    only_missing: bool = True


class WordstatEstimateOut(CostOut):
    total_selected: int
    fresh_skipped: int
    """Сколько фраз уже имеют снимок моложе wordstat_fresh_days и будут пропущены."""


class RunIn(BaseModel):
    target_id: uuid.UUID | None = None
    force: bool = False


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    target_id: uuid.UUID
    status: str
    scheduled_for: date
    started_at: datetime | None
    finished_at: datetime | None
    keywords_total: int
    keywords_done: int
    keywords_pending: int
    keywords_failed: int
    cost_kopecks: int
    trigger: str
    mode: str
    error: str | None


class ReportRow(BaseModel):
    keyword_id: uuid.UUID
    phrase: str
    group_name: str | None
    freq_base: int | None
    position: int | None
    previous_position: int | None
    delta: int | None
    url: str | None
    target_url: str | None
    url_mismatch: bool


class ReportOut(BaseModel):
    items: list[ReportRow]
    total: int
    page: int
    size: int
    checked_on: date | None
    previous_checked_on: date | None
    depth: int


class SummaryOut(BaseModel):
    checked_on: date | None
    keywords: int
    in_top3: int
    in_top10: int
    in_top50: int
    out_of_depth: int
    average_position: float | None
    median_position: float | None


class VisibilityPoint(BaseModel):
    checked_on: date
    top3: float
    top10: float
    top50: float


class UsageRow(BaseModel):
    provider: str
    operation: str
    requests: int
    cost_kopecks: int


class UsageOut(BaseModel):
    month: str
    requests: int
    cost_kopecks: int
    cost_rubles: float
    request_limit: int
    budget_kopecks: int
    limit_reached: bool
    by_operation: list[UsageRow]
    by_project: list[dict]


class RegionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    name: str
    parent_code: str | None


ProjectDetail.model_rebuild()
