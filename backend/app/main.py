"""Точка входа RankPulse API."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, keywords, projects, regions, reports, runs, usage
from app.config import settings

logging.basicConfig(level=settings.log_level)

app = FastAPI(
    title="RankPulse API",
    version="0.1.0",
    description="Трекер позиций и частотности в Яндексе",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(keywords.router)
app.include_router(runs.router)
app.include_router(reports.router)
app.include_router(usage.router)
app.include_router(regions.router)


@app.get("/healthz", tags=["service"])
async def healthz() -> dict:
    return {"status": "ok", "serp_provider": settings.serp_provider}


@app.get("/api/config", tags=["service"])
async def public_config() -> dict:
    """Что интерфейсу нужно знать про режим работы, чтобы честно подписывать цифры."""
    return {
        "serp_provider": settings.serp_provider,
        "wordstat_provider": settings.wordstat_provider,
        "search_mode": settings.yandex_search_api_mode,
        "sync_max_keywords": settings.sync_max_keywords,
        "wordstat_fresh_days": settings.wordstat_fresh_days,
        "deferred_ttl_hours": settings.deferred_result_ttl_hours,
        "depth": settings.yandex_search_depth,
    }
