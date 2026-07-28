#!/usr/bin/env bash
# Восстановление базы из дампа (NFR-6).
#
#   ./scripts/restore.sh backups/tracker-2026-07-28_0400.sql.gz
#
# Что делает:
#   1. останавливает приложение, чтобы никто не писал в базу во время заливки;
#   2. заливает дамп в контейнер db;
#   3. поднимает приложение обратно.
#
# ЭТО РАЗРУШАЮЩАЯ ОПЕРАЦИЯ: дамп снят с --clean, он удаляет существующие
# таблицы перед вставкой. Скрипт спрашивает подтверждение.
#
# Проверять восстановление раз в квартал — часть NFR-6. Делать это лучше
# не на проде, а подняв docker-compose.prod.yml на другой машине.

set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
DUMP="${1:-}"

if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "Использование: $0 <файл дампа .sql.gz>" >&2
  echo "Доступные:" >&2
  ls -1 backups/tracker-*.sql.gz 2>/dev/null >&2 || echo "  (нет)" >&2
  exit 1
fi

# Читаем по ключу, а не через `source`: .env — файл docker compose,
# и значения с пробелами при исполнении оболочкой станут командами.
read_env() {
  grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- \
    | sed -e "s/^'//" -e "s/'\$//" -e 's/^"//' -e 's/"$//'
}

POSTGRES_USER="$(read_env POSTGRES_USER)"
POSTGRES_DB="$(read_env POSTGRES_DB)"

: "${POSTGRES_USER:?нет в .env — psql не будет знать, под кем подключаться}"
: "${POSTGRES_DB:?нет в .env — psql не будет знать, в какую базу заливать}"

echo "Восстановление из $DUMP в базу $POSTGRES_DB."
echo "Текущее содержимое базы будет ЗАМЕЩЕНО."
read -r -p "Продолжить? Напиши «да»: " CONFIRM
if [ "$CONFIRM" != "да" ]; then
  echo "Отменено."
  exit 1
fi

echo "[$(date -Is)] останавливаю приложение"
docker compose -f "$COMPOSE_FILE" stop app

echo "[$(date -Is)] заливаю дамп"
gunzip -c "$DUMP" | docker compose -f "$COMPOSE_FILE" exec -T db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1

echo "[$(date -Is)] поднимаю приложение"
docker compose -f "$COMPOSE_FILE" up -d app

echo "[$(date -Is)] готово. Миграции и сид применятся на старте контейнера."
