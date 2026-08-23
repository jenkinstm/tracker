#!/bin/sh
#
# Удаление драйвера HP LaserJet P2055 с macOS.
#
#   ./scripts/uninstall-macos.sh            — спросит подтверждение
#   ./scripts/uninstall-macos.sh -y         — без вопросов
#   ./scripts/uninstall-macos.sh --queue    — снести только очередь печати
#
# PAPPL, Homebrew и их пакеты не трогаются: они могли попасть в систему не
# из-за этого драйвера.
#

set -eu

PREFIX="${PREFIX:-/usr/local}"
QUEUE="${QUEUE:-HP_LaserJet_P2055}"
PRINTER="${PRINTER:-p2055}"
AGENT_ID="ru.profkosm.p2055-printer-app"
APP="$PREFIX/bin/p2055-printer-app"
SUPPORT="$HOME/Library/Application Support"

ASSUME_YES=0
QUEUE_ONLY=0

for arg in "$@"; do
  case "$arg" in
    -y|--yes)  ASSUME_YES=1 ;;
    --queue)   QUEUE_ONLY=1 ;;
    *)         printf 'Неизвестный аргумент: %s\n' "$arg" >&2; exit 1 ;;
  esac
done

log() { printf '==> %s\n' "$1"; }

[ "$(uname -s)" = "Darwin" ] || { printf 'Скрипт рассчитан на macOS\n' >&2; exit 1; }

if [ "$QUEUE_ONLY" -eq 0 ] && [ "$ASSUME_YES" -eq 0 ]; then
  cat <<TXT
Будут удалены:
  очередь печати            $QUEUE
  принтер в сервисе         $PRINTER
  LaunchAgent               $AGENT_ID
  программа                 $APP
  состояние сервиса         $SUPPORT/p2055-printer-app.state
  очередь заданий           $SUPPORT/p2055-printer-app/
  логи                      ~/Library/Logs/p2055-printer-app.log(.err)
TXT
  printf 'Продолжить? [y/N] '
  read -r answer
  case "$answer" in
    y|Y|yes|Yes) ;;
    *) printf 'Отменено\n'; exit 0 ;;
  esac
fi

if lpstat -p "$QUEUE" >/dev/null 2>&1; then
  log "Удаляю очередь печати $QUEUE"
  sudo lpadmin -x "$QUEUE"
else
  log "Очереди $QUEUE в системе нет"
fi

[ "$QUEUE_ONLY" -eq 1 ] && { log "Готово (сервис и файлы оставлены)"; exit 0; }

if [ -x "$APP" ] && "$APP" status >/dev/null 2>&1; then
  log "Удаляю принтер $PRINTER из сервиса"
  "$APP" delete -d "$PRINTER" || true
  log "Останавливаю сервис"
  "$APP" shutdown || true
fi

if [ -f "$HOME/Library/LaunchAgents/$AGENT_ID.plist" ]; then
  log "Снимаю LaunchAgent"
  launchctl bootout "gui/$(id -u)/$AGENT_ID" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/$AGENT_ID.plist"
fi

if [ -e "$APP" ]; then
  log "Удаляю $APP"
  sudo rm -f "$APP"
fi

log "Удаляю состояние, очередь заданий и логи"
rm -f  "$SUPPORT/p2055-printer-app.state"
rm -rf "$SUPPORT/p2055-printer-app"
rm -f  "$HOME/Library/Logs/p2055-printer-app.log" "$HOME/Library/Logs/p2055-printer-app.err"

log "Готово"
