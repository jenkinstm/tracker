"""Celery: очередь съёма, сбора частотности и опрашивальщик отложенных операций."""

from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from app.config import settings

celery_app = Celery(
    "rankpulse",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["app.tasks.jobs"],
)

celery_app.conf.update(
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    timezone="UTC",
    enable_utc=True,
    result_expires=3600,
    beat_schedule={
        # Опрашивальщик обязан вычерпать пачку заметно быстрее, чем истекут 12 часов.
        "poll-deferred-operations": {
            "task": "app.tasks.jobs.poll_deferred_operations",
            "schedule": float(settings.deferred_poll_interval_seconds),
        },
        # Расписание проектов: сверяем раз в пять минут, попадая в нужную минуту дня.
        "schedule-project-runs": {
            "task": "app.tasks.jobs.schedule_project_runs",
            "schedule": 300.0,
        },
        # Партиции создаём заранее и чистим снимки выдачи старше 90 дней.
        "maintain-partitions": {
            "task": "app.tasks.jobs.maintain_partitions",
            "schedule": crontab(hour=3, minute=15),
        },
    },
)
