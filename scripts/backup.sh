#!/usr/bin/env bash
# Ежедневный бэкап базы (NFR-6). Запускается по cron на сервере:
#
#   0 4 * * * cd /home/deploy/tracker && ./scripts/backup.sh >> backups/backup.log 2>&1
#
# Что делает:
#   1. снимает pg_dump в сжатом виде из работающего контейнера db;
#   2. кладёт его в ./backups с датой в имени;
#   3. удаляет дампы старше RETENTION_DAYS;
#   4. если задан BACKUP_REMOTE — копирует свежий дамп наружу через rclone.
#
# Ничего не удаляет из базы и не трогает контейнеры.

set -euo pipefail

cd "$(dirname "$0")/.."

RETENTION_DAYS="${RETENTION_DAYS:-30}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

if [ ! -f .env ]; then
  echo "Нет .env — не знаю, к какой базе подключаться" >&2
  exit 1
fi

# Имена базы и пользователя берём из .env, чтобы не разъезжаться с DATABASE_URL.
set -a
# shellcheck disable=SC1091
. ./.env
set +a

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y-%m-%d_%H%M)"
FILE="$BACKUP_DIR/tracker-$STAMP.sql.gz"

echo "[$(date -Is)] дамп в $FILE"

# --clean --if-exists: дамп сам умеет разворачиваться поверх существующей схемы.
docker compose -f "$COMPOSE_FILE" exec -T db \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  | gzip -9 > "$FILE"

# Пустой дамп — это отказ, а не успех: молча положить нолик в бэкапы хуже,
# чем упасть, потому что обнаружится это только при восстановлении.
SIZE=$(stat -c%s "$FILE")
if [ "$SIZE" -lt 1024 ]; then
  echo "Дамп подозрительно мал ($SIZE байт) — удаляю и падаю" >&2
  rm -f "$FILE"
  exit 1
fi

echo "[$(date -Is)] готово, $SIZE байт"

find "$BACKUP_DIR" -name 'tracker-*.sql.gz' -mtime "+$RETENTION_DAYS" -print -delete

# Копия наружу: диск сервера — не бэкап, если сервер и есть точка отказа.
if [ -n "${BACKUP_REMOTE:-}" ]; then
  echo "[$(date -Is)] выгрузка в $BACKUP_REMOTE"
  rclone copy "$FILE" "$BACKUP_REMOTE"
fi
