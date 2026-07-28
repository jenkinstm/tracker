# Образ только для локальной разработки: исходники приезжают bind-mount'ом,
# ничего внутрь не копируется. Прод-образ появится в блоке 7.
FROM node:22-bookworm-slim

# openssl нужен движку Prisma
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

RUN npm install --global pnpm@10

ENV HOME=/home/app \
    npm_config_store_dir=/pnpm-store

RUN mkdir -p /home/app /pnpm-store /app \
  && chown -R 1001:1001 /home/app /pnpm-store /app

WORKDIR /app
USER 1001:1001
