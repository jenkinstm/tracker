"""Настройки приложения. Единственный источник правды — переменные окружения."""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"), env_file_encoding="utf-8", extra="ignore"
    )

    app_env: str = "development"
    secret_key: str = "change-me-32-bytes-min"
    base_url: str = "http://localhost:3000"
    log_level: str = "INFO"

    database_url: str = "postgresql+asyncpg://rankpulse:rankpulse@localhost:5432/rankpulse"
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    access_token_ttl_minutes: int = 43200
    cors_origins: str = "http://localhost:3000"

    # Провайдеры. mock — детерминированная заглушка, боевых денег не тратит.
    serp_provider: str = "mock"
    wordstat_provider: str = "mock"

    yandex_search_api_key: str = ""
    yandex_cloud_folder_id: str = ""
    yandex_search_api_mode: str = "deferred"
    yandex_search_depth: int = 100
    yandex_search_price_per_1000_kopecks: int = 3050
    yandex_search_sync_price_per_1000_kopecks: int = 48800
    yandex_wordstat_rps: int = 5
    yandex_wordstat_price_per_1000_kopecks: int = 10000
    yandex_wordstat_num_phrases: int = 100
    yandex_wordstat_fix_typo: bool = True
    yandex_wordstat_filter_mode: str = "moderate"

    sync_max_keywords: int = 100
    deferred_result_ttl_hours: int = 12
    deferred_batch_size: int = 5000
    deferred_poll_interval_seconds: int = 60
    deferred_first_poll_delay_seconds: int = 300

    monthly_request_limit: int = 100_000
    monthly_budget_kopecks: int = 500_000

    # Порог, ниже которого ассоциации Вордстата не показываем: шум.
    wordstat_association_min_count: int = 100
    # Повторный сбор частотности моложе этого возраста требует подтверждения.
    wordstat_fresh_days: int = 30

    sentry_dsn: str = ""

    xmlriver_user: str = ""
    xmlriver_key: str = ""

    request_timeout_seconds: float = Field(default=30.0)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def sync_database_url(self) -> str:
        """Синхронный URL для Alembic и Celery-задач."""
        return self.database_url.replace("+asyncpg", "+psycopg")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
