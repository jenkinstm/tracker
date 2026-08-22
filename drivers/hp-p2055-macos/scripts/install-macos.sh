#!/bin/sh
#
# Установка драйвера HP LaserJet P2055 на macOS (Apple Silicon и Intel).
#
#   ./scripts/install-macos.sh 192.168.1.50    — принтер по сети (JetDirect, порт 9100)
#   ./scripts/install-macos.sh --usb           — принтер по USB
#
# Скрипт собирает printer application, ставит его в PREFIX/bin, поднимает
# как LaunchAgent и добавляет очередь печати через драйверless-протокол.
# Ничего не делает молча: каждый шаг печатает, что именно выполняется.
#

set -eu

PREFIX="${PREFIX:-/usr/local}"
PORT="${PORT:-8631}"
QUEUE="${QUEUE:-HP_LaserJet_P2055}"
PRINTER="${PRINTER:-p2055}"
AGENT_ID="ru.profkosm.p2055-printer-app"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

log() { printf '==> %s\n' "$1"; }
die() { printf 'Ошибка: %s\n' "$1" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "скрипт рассчитан на macOS"

if [ $# -lt 1 ]; then
  die "укажите адрес принтера или --usb (см. комментарий в начале скрипта)"
fi

case "$1" in
  --usb) DEVICE_URI="usb://HP/LaserJet%20P2055" ;;
  *)     DEVICE_URI="socket://$1" ;;
esac

log "Проверяю инструменты сборки"
xcode-select -p >/dev/null 2>&1 || die "нет Command Line Tools, выполните: xcode-select --install"

log "Проверяю библиотеку PAPPL"
if ! pkg-config --exists pappl 2>/dev/null; then
  if command -v brew >/dev/null 2>&1 && brew install pappl >/dev/null 2>&1; then
    log "PAPPL установлена через Homebrew"
  else
    log "Собираю PAPPL из исходников в /tmp/pappl-build"
    rm -rf /tmp/pappl-build
    git clone --depth 1 https://github.com/michaelrsweet/pappl.git /tmp/pappl-build
    (cd /tmp/pappl-build && ./configure --prefix="$PREFIX" && make && sudo make install)
  fi
fi

log "Собираю драйвер"
make -C "$SRC_DIR" test
make -C "$SRC_DIR" app

log "Устанавливаю в $PREFIX/bin"
sudo make -C "$SRC_DIR" install PREFIX="$PREFIX"

log "Ставлю LaunchAgent $AGENT_ID"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs" \
         "$HOME/Library/Application Support/p2055-printer-app"
sed -e "s|@PREFIX@|$PREFIX|g" -e "s|@HOME@|$HOME|g" -e "s|@PORT@|$PORT|g" \
    "$SRC_DIR/scripts/$AGENT_ID.plist.in" > "$HOME/Library/LaunchAgents/$AGENT_ID.plist"

launchctl bootout "gui/$(id -u)/$AGENT_ID" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/$AGENT_ID.plist"

log "Жду запуска сервиса на порту $PORT"
i=0
while [ $i -lt 20 ]; do
  if "$PREFIX/bin/p2055-printer-app" status >/dev/null 2>&1; then
    break
  fi
  i=$((i + 1))
  sleep 1
done
[ $i -lt 20 ] || die "сервис не поднялся, смотрите ~/Library/Logs/p2055-printer-app.log"

log "Регистрирую принтер $PRINTER ($DEVICE_URI)"
"$PREFIX/bin/p2055-printer-app" delete -d "$PRINTER" >/dev/null 2>&1 || true
"$PREFIX/bin/p2055-printer-app" add -d "$PRINTER" -v "$DEVICE_URI" -m hp_laserjet_p2055

log "Добавляю очередь печати $QUEUE в macOS"
if lpstat -p "$QUEUE" >/dev/null 2>&1; then
  sudo lpadmin -x "$QUEUE"
fi
sudo lpadmin -p "$QUEUE" -E -v "ipp://localhost:$PORT/ipp/print/$PRINTER" -m everywhere \
             -o printer-is-shared=false -D "HP LaserJet P2055"

log "Готово. Очередь: $QUEUE, веб-интерфейс: http://localhost:$PORT/"
log "Проверка: lpr -P $QUEUE файл.pdf"
