"""Начальная схема RankPulse (M1)

Revision ID: 0001
Revises:
Create Date: 2026-08-28
"""

from collections.abc import Sequence
from datetime import date

from alembic import op

from app.services.partitions import PARTITIONED_TABLES, create_partition_sql, months_around

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    op.execute(
        """
        CREATE TABLE users (
            id uuid PRIMARY KEY,
            email citext NOT NULL UNIQUE,
            hashed_password text NOT NULL,
            is_active boolean NOT NULL DEFAULT true,
            monthly_request_limit integer NOT NULL DEFAULT 100000,
            monthly_budget_kopecks bigint NOT NULL DEFAULT 500000,
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )

    op.execute(
        """
        CREATE TABLE projects (
            id uuid PRIMARY KEY,
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name varchar(200) NOT NULL,
            domain varchar(253) NOT NULL,
            match_subdomains boolean NOT NULL DEFAULT false,
            fix_typos boolean NOT NULL DEFAULT true,
            schedule varchar(16) NOT NULL DEFAULT 'manual',
            schedule_time time NOT NULL DEFAULT '08:00',
            timezone varchar(64) NOT NULL DEFAULT 'Europe/Moscow',
            is_active boolean NOT NULL DEFAULT true,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT ck_project_schedule CHECK (schedule IN ('manual','weekly','daily'))
        )
        """
    )
    op.execute("CREATE INDEX ix_projects_user_id ON projects(user_id)")

    op.execute(
        """
        CREATE TABLE project_targets (
            id uuid PRIMARY KEY,
            project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            engine varchar(16) NOT NULL DEFAULT 'yandex',
            region_code varchar(16) NOT NULL,
            device varchar(16) NOT NULL DEFAULT 'desktop',
            depth smallint NOT NULL DEFAULT 100,
            lang varchar(8),
            is_enabled boolean NOT NULL DEFAULT true,
            sort_order smallint NOT NULL DEFAULT 0,
            CONSTRAINT uq_target_project_engine_region
                UNIQUE (project_id, engine, region_code, device),
            -- Глубина в Яндексе зафиксирована: сотня приходит одним запросом,
            -- вторая сотня стоит отдельных денег и практической пользы не даёт.
            CONSTRAINT ck_target_yandex_depth CHECK (engine <> 'yandex' OR depth = 100)
        )
        """
    )
    op.execute("CREATE INDEX ix_project_targets_project_id ON project_targets(project_id)")

    op.execute(
        """
        CREATE TABLE keyword_groups (
            id uuid PRIMARY KEY,
            project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            name varchar(200) NOT NULL,
            parent_id uuid REFERENCES keyword_groups(id) ON DELETE SET NULL,
            sort_order smallint NOT NULL DEFAULT 0
        )
        """
    )
    op.execute("CREATE INDEX ix_keyword_groups_project_id ON keyword_groups(project_id)")

    op.execute(
        """
        CREATE TABLE keywords (
            id uuid PRIMARY KEY,
            project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            group_id uuid REFERENCES keyword_groups(id) ON DELETE SET NULL,
            phrase text NOT NULL,
            phrase_normalized text NOT NULL,
            target_url text,
            is_active boolean NOT NULL DEFAULT true,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_keyword_project_normalized UNIQUE (project_id, phrase_normalized)
        )
        """
    )
    op.execute("CREATE INDEX ix_keywords_project_id ON keywords(project_id)")
    op.execute("CREATE INDEX ix_keywords_group_id ON keywords(group_id)")
    op.execute(
        "CREATE INDEX ix_keywords_phrase_trgm ON keywords USING gin (phrase_normalized gin_trgm_ops)"
    )

    op.execute(
        """
        CREATE TABLE wordstat_snapshots (
            id bigserial PRIMARY KEY,
            keyword_id uuid NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
            region_yandex integer,
            freq_base integer NOT NULL,
            freq_exact integer,
            freq_exact_form integer,
            device varchar(16) NOT NULL DEFAULT 'all',
            collected_at timestamptz NOT NULL DEFAULT now(),
            provider varchar(32) NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_wordstat_keyword_collected "
        "ON wordstat_snapshots(keyword_id, collected_at DESC)"
    )

    op.execute(
        """
        CREATE TABLE wordstat_associations (
            id bigserial PRIMARY KEY,
            keyword_id uuid NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
            phrase text NOT NULL,
            count integer NOT NULL,
            kind varchar(16) NOT NULL,
            is_dismissed boolean NOT NULL DEFAULT false,
            collected_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_association_keyword ON wordstat_associations(keyword_id, is_dismissed)"
    )

    op.execute(
        """
        CREATE TABLE check_runs (
            id uuid PRIMARY KEY,
            project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            target_id uuid NOT NULL REFERENCES project_targets(id) ON DELETE CASCADE,
            status varchar(16) NOT NULL DEFAULT 'queued',
            scheduled_for date NOT NULL,
            started_at timestamptz,
            finished_at timestamptz,
            keywords_total integer NOT NULL DEFAULT 0,
            keywords_done integer NOT NULL DEFAULT 0,
            keywords_pending integer NOT NULL DEFAULT 0,
            keywords_failed integer NOT NULL DEFAULT 0,
            cost_kopecks bigint NOT NULL DEFAULT 0,
            trigger varchar(16) NOT NULL DEFAULT 'manual',
            mode varchar(16) NOT NULL DEFAULT 'deferred',
            error text,
            CONSTRAINT uq_run_project_date UNIQUE (project_id, target_id, scheduled_for)
        )
        """
    )
    op.execute("CREATE INDEX ix_check_runs_project_id ON check_runs(project_id)")

    op.execute(
        """
        CREATE TABLE positions (
            id bigserial NOT NULL,
            checked_on date NOT NULL,
            check_run_id uuid NOT NULL,
            keyword_id uuid NOT NULL,
            target_id uuid NOT NULL,
            position smallint,
            url text,
            device varchar(16) NOT NULL DEFAULT 'desktop',
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (id, checked_on),
            CONSTRAINT uq_position_keyword_date UNIQUE (keyword_id, target_id, checked_on)
        ) PARTITION BY RANGE (checked_on)
        """
    )
    op.execute("CREATE INDEX ix_position_keyword_date ON positions(keyword_id, checked_on DESC)")
    op.execute("CREATE INDEX ix_position_run ON positions(check_run_id)")

    op.execute(
        """
        CREATE TABLE serp_snapshots (
            id bigserial NOT NULL,
            checked_on date NOT NULL,
            check_run_id uuid NOT NULL,
            keyword_id uuid NOT NULL,
            target_id uuid NOT NULL,
            results jsonb NOT NULL,
            PRIMARY KEY (id, checked_on),
            CONSTRAINT uq_serp_keyword_date UNIQUE (keyword_id, target_id, checked_on)
        ) PARTITION BY RANGE (checked_on)
        """
    )
    op.execute("CREATE INDEX ix_serp_run ON serp_snapshots(check_run_id)")

    for table in PARTITIONED_TABLES:
        for month in months_around(date.today(), back=2, ahead=3):
            op.execute(create_partition_sql(table, month))

    op.execute(
        """
        CREATE TABLE deferred_operations (
            id bigserial PRIMARY KEY,
            operation_id varchar(128) NOT NULL UNIQUE,
            check_run_id uuid NOT NULL REFERENCES check_runs(id) ON DELETE CASCADE,
            keyword_id uuid NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
            submitted_at timestamptz NOT NULL DEFAULT now(),
            expires_at timestamptz NOT NULL,
            status varchar(16) NOT NULL DEFAULT 'pending',
            poll_attempts smallint NOT NULL DEFAULT 0,
            last_polled_at timestamptz,
            cost_kopecks bigint NOT NULL DEFAULT 0,
            retry_of varchar(128)
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_deferred_status_expires ON deferred_operations(status, expires_at)"
    )
    op.execute("CREATE INDEX ix_deferred_operations_check_run_id ON deferred_operations(check_run_id)")

    op.execute(
        """
        CREATE TABLE regions (
            code varchar(16) PRIMARY KEY,
            name varchar(200) NOT NULL,
            parent_code varchar(16),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )

    op.execute(
        """
        CREATE TABLE api_usage_log (
            id bigserial PRIMARY KEY,
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            project_id uuid,
            provider varchar(32) NOT NULL,
            operation varchar(32) NOT NULL,
            requests integer NOT NULL DEFAULT 1,
            cost_kopecks bigint NOT NULL DEFAULT 0,
            status varchar(16) NOT NULL DEFAULT 'ok',
            error_code varchar(64),
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_usage_user_created ON api_usage_log(user_id, created_at DESC)")

    op.execute(
        """
        CREATE TABLE provider_settings (
            id uuid PRIMARY KEY,
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            provider varchar(32) NOT NULL,
            credentials jsonb NOT NULL DEFAULT '{}'::jsonb,
            price_per_1000_kopecks integer NOT NULL DEFAULT 0,
            is_enabled boolean NOT NULL DEFAULT true,
            priority smallint NOT NULL DEFAULT 0,
            CONSTRAINT uq_provider_user UNIQUE (user_id, provider)
        )
        """
    )


def downgrade() -> None:
    for table in (
        "provider_settings",
        "api_usage_log",
        "regions",
        "deferred_operations",
        "serp_snapshots",
        "positions",
        "check_runs",
        "wordstat_associations",
        "wordstat_snapshots",
        "keywords",
        "keyword_groups",
        "project_targets",
        "projects",
        "users",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
