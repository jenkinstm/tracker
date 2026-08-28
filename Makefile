.PHONY: help up down logs migrate seed test lint fmt dev-install dev stop status

help:
	@echo "up          — поднять весь стек в docker compose"
	@echo "down        — остановить стек"
	@echo "migrate     — накатить миграции"
	@echo "seed        — демо-проект на 50 фраз (+ history для истории съёмов)"
	@echo "test        — тесты бэкенда"
	@echo "lint        — ruff и mypy"
	@echo "dev-install — локальная установка без docker"
	@echo "dev / stop / status — локальный запуск процессов"

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f --tail=100

migrate:
	cd backend && .venv/bin/alembic upgrade head

seed:
	cd backend && .venv/bin/python -m app.seed --history

test:
	cd backend && .venv/bin/python -m pytest -q

lint:
	cd backend && .venv/bin/ruff check app tests && .venv/bin/mypy app || true
	cd frontend && npx tsc --noEmit

dev-install:
	cd backend && uv venv --python 3.12 .venv && .venv/bin/python -m ensurepip --upgrade >/dev/null 2>&1 || true
	cd backend && uv pip install --python .venv/bin/python -e ".[dev]"
	cd frontend && npm install

dev:
	./scripts/dev.sh start

stop:
	./scripts/dev.sh stop

status:
	./scripts/dev.sh status
