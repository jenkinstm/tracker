#!/usr/bin/env bash
# Локальный запуск без docker: postgres и redis берутся системные.
# Использование: scripts/dev.sh start | stop | status | logs
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VAR="$ROOT/var"
mkdir -p "$VAR"

start_one() {
  local name="$1"; shift
  local dir="$1"; shift
  if [ -f "$VAR/$name.pid" ] && kill -0 "$(cat "$VAR/$name.pid")" 2>/dev/null; then
    echo "$name уже запущен (pid $(cat "$VAR/$name.pid"))"
    return
  fi
  ( cd "$dir" && nohup "$@" > "$VAR/$name.log" 2>&1 & echo $! > "$VAR/$name.pid" )
  echo "$name запущен (pid $(cat "$VAR/$name.pid"))"
}

stop_one() {
  local name="$1"
  if [ -f "$VAR/$name.pid" ]; then
    local pid; pid="$(cat "$VAR/$name.pid")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$VAR/$name.pid"
    echo "$name остановлен"
  fi
}

case "${1:-start}" in
  start)
    PY="$ROOT/backend/.venv/bin"
    start_one api "$ROOT/backend" "$PY/uvicorn" app.main:app --host 0.0.0.0 --port 8000
    start_one worker "$ROOT/backend" "$PY/celery" -A app.tasks.celery_app.celery_app worker -l info --concurrency 4
    start_one beat "$ROOT/backend" "$PY/celery" -A app.tasks.celery_app.celery_app beat -l info
    start_one frontend "$ROOT/frontend" npm run dev
    ;;
  stop)
    for name in frontend beat worker api; do stop_one "$name"; done
    ;;
  status)
    for name in api worker beat frontend; do
      if [ -f "$VAR/$name.pid" ] && kill -0 "$(cat "$VAR/$name.pid")" 2>/dev/null; then
        echo "$name: работает (pid $(cat "$VAR/$name.pid"))"
      else
        echo "$name: остановлен"
      fi
    done
    ;;
  logs)
    tail -n 50 "$VAR"/*.log
    ;;
  *)
    echo "Использование: $0 start|stop|status|logs" >&2
    exit 1
    ;;
esac
