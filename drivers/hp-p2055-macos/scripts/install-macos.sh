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
PAPPL_BRANCH="${PAPPL_BRANCH:-v1.4.x}"
PAPPL_BUILD_DIR="${TMPDIR:-/tmp}/pappl-build"
ARCH=""  # определяется при сборке PAPPL, см. ниже
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
if pkg-config --exists pappl 2>/dev/null; then
  log "PAPPL уже установлена, версия $(pkg-config --modversion pappl)"
elif [ -f "$PREFIX/include/pappl/pappl.h" ]; then
  log "PAPPL уже установлена в $PREFIX"
else
  # Ветка master требует CUPS 2.5 или libcups3, а macOS даёт CUPS 2.x —
  # configure там падает с "requires libcups2-dev>=2.5 or libcups3-dev".
  # Ветка v1.4.x работает с CUPS 2.2+ через cups-config, который есть в системе.
  command -v cups-config >/dev/null 2>&1 ||
    die "в системе нет cups-config; поставьте Command Line Tools (xcode-select --install)"

  # PAPPL ищет TLS только через pkg-config, а в macOS нет ни pkg-config, ни
  # заголовков OpenSSL — без них configure падает с "TLS support is required".
  command -v brew >/dev/null 2>&1 ||
    die "для сборки PAPPL нужен Homebrew (https://brew.sh): он даёт pkg-config и OpenSSL"

  if ! command -v pkg-config >/dev/null 2>&1; then
    log "Ставлю pkg-config"
    brew install pkgconf || brew install pkg-config
  fi

  if ! brew list openssl@3 >/dev/null 2>&1; then
    log "Ставлю OpenSSL"
    brew install openssl@3
  fi

  # openssl@3 в Homebrew keg-only, его pkgconfig не лежит в путях по умолчанию.
  PKG_CONFIG_PATH="$(brew --prefix openssl@3)/lib/pkgconfig:${PKG_CONFIG_PATH:-}"
  export PKG_CONFIG_PATH

  # PAPPL на macOS 11+ по умолчанию собирается universal (x86_64 + arm64), а
  # библиотеки Homebrew есть только под архитектуру машины — срез x86_64 не
  # линкуется («ignoring file ... required architecture x86_64»). Явный -arch
  # отключает universal-режим в configure. Архитектуру берём у самой библиотеки
  # Homebrew, а не у оболочки: под Rosetta uname -m соврёт.
  ARCH="$(lipo -archs "$(brew --prefix openssl@3)/lib/libssl.dylib" 2>/dev/null | awk '{print $1}')"
  [ -n "$ARCH" ] || ARCH="$(uname -m)"
  log "Целевая архитектура: $ARCH"

  log "Собираю PAPPL ($PAPPL_BRANCH) из исходников в $PAPPL_BUILD_DIR"
  rm -rf "$PAPPL_BUILD_DIR"
  git clone --depth 1 --branch "$PAPPL_BRANCH" https://github.com/michaelrsweet/pappl.git "$PAPPL_BUILD_DIR"
  (cd "$PAPPL_BUILD_DIR" &&
     ./configure --prefix="$PREFIX" --with-tls=openssl \
                 CFLAGS="-arch $ARCH" LDFLAGS="-arch $ARCH" &&
     make)
  sudo make -C "$PAPPL_BUILD_DIR" install
fi

log "Собираю драйвер"
make -C "$SRC_DIR" test
make -C "$SRC_DIR" app PAPPL_PREFIX="$PREFIX" ${ARCH:+ARCH="$ARCH"}

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
