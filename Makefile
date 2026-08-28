.PHONY: help up down logs seed migrate test lint dev-install migrate-local seed-local dev stop status

help:
	@echo "— через docker compose —"
	@echo "up           — поднять весь стек (миграции накатываются сами)"
	@echo "down         — остановить стек"
	@echo "logs         — логи всех сервисов"
	@echo "seed         — демо-проект на 50 фраз с историей съёмов"
	@echo "migrate      — накатить миграции вручную"
	@echo ""
	@echo "— без docker —"
	@echo "dev-install  — venv для бэкенда и node_modules для фронтенда"
	@echo "migrate-local / seed-local"
	@echo "dev / stop / status — запуск, остановка и состояние процессов"
	@echo ""
	@echo "test         — тесты бэкенда"
	@echo "lint         — ruff, mypy и tsc"

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f --tail=100

migrate:
	docker compose exec api alembic upgrade head

seed:
	docker compose exec api python -m app.seed --history

migrate-local:
	cd backend && .venv/bin/alembic upgrade head

seed-local:
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
