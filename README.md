# Трекер питания, тренировок и веса

Личный self-hosted трекер. Один пользователь, PWA, деплой на VPS.

## Документы

| Файл | Что внутри |
|---|---|
| `CLAUDE.md` | Правила работы над проектом для Claude Code |
| `docs/spec.md` | Полное ТЗ: требования FR-x.x, схема БД, API, критерии приёмки |
| `docs/context.md` | Принятые решения, дефолты профиля, формулы расчётов |
| `docs/roadmap.md` | Порядок блоков работ и что уже сделано |
| `docs/kickoff.md` | Первое сообщение для Claude Code |

## Стек

React + TypeScript + Vite · Fastify + Prisma · PostgreSQL 16 · Caddy · Docker Compose

Монорепозиторий на pnpm workspaces: `apps/web`, `apps/api`, `packages/shared`.

## Разработка

Node на хосте не нужен — всё живёт в контейнерах.

```bash
docker compose up -d
```

Поднимаются три сервиса: `db` (postgres:16, наружу не публикуется), `api`
(Fastify на 3000, внутри сети) и `web` (Vite на 5173, проксирует `/api` в `api`).
Миграции применяются на старте контейнера `api`.

Пароль для входа:

```bash
docker compose run --rm --no-deps api pnpm hash-password
```

Скрипт спросит пароль дважды, посчитает argon2id-хеш и запишет его прямо
в `.env` — в терминале и в истории команд хеш не остаётся. Если `SESSION_SECRET`
пуст, он тоже сгенерируется. После этого `docker compose up -d --force-recreate api`.

> Значения в `.env` пишутся **в одинарных кавычках**. Docker Compose интерполирует
> этот файл, и argon2id-хеш вида `$argon2id$v=19$m=...` без кавычек приезжает
> в контейнер выпотрошенным. Скрипт делает это сам, руками — не забывай.

Тесты и типы:

```bash
docker compose run --rm --no-deps api pnpm test
```

```bash
docker compose run --rm --no-deps api pnpm typecheck
```

Новая миграция после правки `apps/api/prisma/schema.prisma`:

```bash
docker compose run --rm --no-deps api pnpm --filter @tracker/api exec prisma migrate dev --name <имя>
```

Если Node установлен локально, те же `pnpm test`, `pnpm typecheck`
и `pnpm hash-password` работают напрямую из корня.
