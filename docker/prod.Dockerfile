# Продовый образ: собирается в CI, на сервер приезжает готовым.
#
# Фронт собирать на сервере нельзя — 2 ГБ RAM не хватит на vite build
# (правило из CLAUDE.md). Поэтому здесь многостадийная сборка, а сервер
# только тянет образ из registry.

# ─────────────────────────────────────────── зависимости
FROM node:22-slim AS deps

# Версия pnpm закреплена в package.json (packageManager) и ставится явно:
# corepack тянет свежую, а её политики отличаются от тех, под которыми
# собран pnpm-lock.yaml.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@10
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile

# ─────────────────────────────────────────── сборка фронта
FROM deps AS web-build

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web

RUN pnpm --filter @tracker/web build

# ─────────────────────────────────────────── прод-зависимости бэка
FROM node:22-slim AS api-deps

# Версия pnpm закреплена в package.json (packageManager) и ставится явно:
# corepack тянет свежую, а её политики отличаются от тех, под которыми
# собран pnpm-lock.yaml.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@10
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

# Бэк ходит через tsx, поэтому devDependencies нужны и в проде.
RUN pnpm install --frozen-lockfile --filter @tracker/api... --filter @tracker/shared...

# ─────────────────────────────────────────── итоговый образ
FROM node:22-slim AS runtime

# Версия pnpm закреплена в package.json (packageManager) и ставится явно:
# corepack тянет свежую, а её политики отличаются от тех, под которыми
# собран pnpm-lock.yaml.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@10
WORKDIR /app

ENV NODE_ENV=production

COPY --from=api-deps /app/node_modules ./node_modules
COPY --from=api-deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=api-deps /app/apps/api/node_modules ./apps/api/node_modules

COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

# Собранный фронт отдаёт Caddy, но он лежит в этом же образе:
# так деплой остаётся одной операцией, а версии фронта и бэка не разъезжаются.
COPY --from=web-build /app/apps/web/dist ./web

RUN pnpm --filter @tracker/api exec prisma generate

# Порт слушается внутри сети compose, наружу его выставляет Caddy.
EXPOSE 3000

# Миграции и сид применяются на старте: обе операции идемпотентны.
CMD ["sh", "-c", "pnpm --filter @tracker/api exec prisma migrate deploy && pnpm --filter @tracker/api db:seed && pnpm --filter @tracker/api start"]
