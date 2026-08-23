# Драйвер HP LaserJet P2055 для macOS 26 (Mac mini M4)

## Почему драйвер выглядит именно так

В macOS драйвер принтера — это не модуль ядра. Печатью занимается CUPS в
пространстве пользователя, а «драйвер» — это фильтр, превращающий растр в язык
принтера. Начиная с Catalina Apple объявила классические драйверы с PPD
устаревшими, из системы убраны и вендорские пакеты, и возможность положить свой
фильтр в `/usr/libexec/cups/filter` (том системы смонтирован только на чтение и
защищён SIP). Единственный поддерживаемый способ подключить принтер без AirPrint
на macOS 26 — **printer application**: локальный сервис, который объявляет себя
по Bonjour как IPP Everywhere/AirPrint-принтер, принимает от системы PWG-растр и
сам отправляет на принтер его родной язык.

P2055 AirPrint не умеет, но понимает PCL 5e, PCL 6 и эмуляцию PostScript 3.
Драйвер здесь генерирует **PCL 5e** — самый предсказуемый из трёх на этом
семействе.

Итого схема:

```
приложение → macOS/CUPS → PWG-растр → p2055-printer-app (этот драйвер) → PCL 5e → принтер
                                          ↑ localhost:8631, виден как AirPrint
```

## Быстрая установка

```sh
cd drivers/hp-p2055-macos
./scripts/install-macos.sh 192.168.1.50   # адрес принтера в сети
./scripts/install-macos.sh --usb          # или подключение по USB
```

Скрипт соберёт драйвер, установит его в `/usr/local/bin`, поднимет LaunchAgent
`ru.profkosm.p2055-printer-app` и добавит очередь `HP_LaserJet_P2055`. После
этого принтер доступен из любого приложения, а веб-интерфейс сервиса —
на `http://localhost:8631/`.

Сборка нативная под arm64, Rosetta не нужна.

### Требования и подводный камень с PAPPL

Драйверу нужна библиотека PAPPL. Если её нет, скрипт собирает её сам — но
строго из ветки **v1.4.x**. Ветка `master` (будущая PAPPL 2.0) требует CUPS 2.5
или libcups3, которых в macOS нет, и её `configure` падает так:

```
configure: error: Sorry, this software requires libcups2-dev>=2.5 or libcups3-dev.
```

PAPPL 1.4.x собирается с CUPS 2.2+ через `cups-config` из Command Line Tools —
это то, что стоит на маке. Если PAPPL уже установлена (Homebrew или своя
сборка), скрипт возьмёт её и ничего собирать не станет. Версию ветки можно
переопределить: `PAPPL_BRANCH=v1.3.x ./scripts/install-macos.sh ...`.

Вторая мина там же:

```
configure: error: TLS support is required.
```

PAPPL ищет OpenSSL или GnuTLS **только через pkg-config**, а в macOS нет ни
pkg-config, ни заголовков OpenSSL — обе проверки молча пропускаются, и сборка
останавливается. Скрипт ставит недостающее сам; вручную это выглядит так:

```sh
brew install pkgconf openssl@3
export PKG_CONFIG_PATH="$(brew --prefix openssl@3)/lib/pkgconfig:$PKG_CONFIG_PATH"
./configure --prefix=/usr/local --with-tls=openssl && make && sudo make install
```

`openssl@3` в Homebrew keg-only, поэтому без `PKG_CONFIG_PATH` его не видно.
Homebrew для этого шага обязателен — своей библиотеки TLS с pkg-config-описанием
macOS не даёт.

И третья, уже на линковке:

```
ld: warning: ignoring file '/opt/homebrew/.../libssl.dylib':
    found architecture 'arm64', required architecture 'x86_64'
Undefined symbols for architecture x86_64
```

PAPPL на macOS 11+ по умолчанию собирается universal (`-arch x86_64 -arch arm64`),
а Homebrew ставит библиотеки только под архитектуру машины — срез x86_64 линковать
нечем. Явный `-arch` в `CFLAGS`/`LDFLAGS` отключает universal-режим:

```sh
./configure --prefix=/usr/local --with-tls=openssl \
            CFLAGS="-arch arm64" LDFLAGS="-arch arm64"
```

Скрипт берёт архитектуру у самой библиотеки Homebrew (`lipo -archs`), а не у
`uname -m`: под Rosetta тот покажет x86_64 и сборка снова не сойдётся. Драйвер
собирается так же — `make app ARCH=arm64`, и на маке `make` дополнительно
вырезает `-arch` из флагов `cups-config`, которые Apple тоже отдаёт
universal-набором.

`pkg-config` на маке обычно отсутствует, поэтому `make app` умеет искать PAPPL
по префиксу установки: `make app PAPPL_PREFIX=/opt/homebrew`.

## Из чего состоит

| Файл | Назначение |
| --- | --- |
| `src/p2055_pcl.{c,h}` | ядро: генерация PCL 5e, сжатие растра (режимы 0/2/3) |
| `src/p2055_pappl.c` | printer application на PAPPL — основной путь для macOS 26 |
| `src/rastertop2055.c` | CUPS-фильтр для систем, где ещё работают очереди с PPD |
| `ppd/HP-LaserJet-P2055.ppd` | PPD для этого фильтра (проходит `cupstestppd`) |
| `tests/test_p2055_pcl.c` | тесты ядра: обратимость сжатия, границы, дуплекс |
| `tests/pcl_decode.{c,h}` | декодер PCL обратно в растр (для тестов и pcldump) |
| `tests/pcldump.c` | утилита разбора готового потока PCL |
| `scripts/install-macos.sh` | установка на macOS |
| `scripts/uninstall-macos.sh` | удаление очереди, сервиса и файлов |

Ядро ничего не знает ни о CUPS, ни о PAPPL: на вход — однобитные строки растра,
на выход — байты PCL. Поэтому один и тот же код работает в обоих фронтендах и
проверяется тестами на любой машине.

## Что именно делает ядро

* Обвязка PJL: `UEL` → `@PJL SET RESOLUTION` → `ENTER LANGUAGE=PCL`, в конце `EOJ`.
  Имя задания и пользователь чистятся от кавычек и управляющих символов —
  иначе принтер обрывает разбор команды.
* Настройки страницы: формат, подача, тип носителя, дуплекс, копии, экономрежим,
  разрешение 600/1200 dpi.
* Растр: для каждой строки считаются TIFF-упаковка (режим 2) и delta row
  (режим 3, разница с предыдущей строкой), выбирается самый короткий вариант,
  включая несжатый. Пустые строки в дуплексном документе стоят несколько байт.
  На тестовой A4 при 600 dpi поток занимает ~8 % от несжатого растра, пустая
  страница — 35 КБ.
* Дуплекс: лицевая сторона задаёт режим `ESC&l#S`, оборотная помечается
  `ESC&a2G`, лист выталкивается только после оборота.

## Сборка и тесты

```sh
make test      # тесты ядра + сборка pcldump (зависимостей нет)
make app       # printer application (нужны PAPPL 1.2+ и libcups)
make filter    # CUPS-фильтр (нужны заголовки CUPS)
```

Тесты проверяют не совпадение с эталонным дампом, а обратимость: поток
разбирается декодером PCL и растр сравнивается с исходным. Отдельно закрыты
граничные случаи: растр 1×1, пустая страница, полностью различающиеся строки,
смещения delta row больше 30 и больше 255 байт, переполнение выходного буфера,
неверная длина строки, обрыв записи в принтер.

## Проверка без принтера

```sh
make pcldump
./build/pcldump job.pcl --pbm job.pbm
```

`pcldump` печатает отчёт (разрешение, формат, дуплекс, число страниц и строк,
доля растровых данных) и по желанию выгружает восстановленный растр в PBM —
его открывает любой просмотрщик. Если отчёт сходится с ожиданиями, принтер
получит именно то, что нарисовало приложение.

## Запасной путь: CUPS + PPD

Для Linux или старых macOS, где классические очереди ещё работают:

```sh
make filter
sudo make install-filter          # /usr/local/libexec/cups/filter + PPD
lpadmin -p P2055 -E -v socket://192.168.1.50 -P ppd/HP-LaserJet-P2055.ppd
```

На macOS 26 этот путь работать не будет: систему нельзя убедить запускать
сторонний фильтр из `/usr/local`. Он оставлен как рабочий вариант для других
систем и как способ отладить генерацию PCL через обычный конвейер CUPS.

## Что проверено, а что нет

Проверено:

* ядро PCL — 1310 проверок, включая полный цикл «растр → PCL → растр»;
* printer application собран с PAPPL 1.3.1 и 1.4.13 и прогнан end-to-end: PNG →
  PWG-растр → PCL, поток принят виртуальным JetDirect-приёмником, разобран
  обратно и совпал с исходным изображением;
* печать готового файла PCL напрямую (`-o document-format=application/vnd.hp-pcl`)
  — на принтер уходит побайтово тот же файл;
* сборка PAPPL 1.4.13 из ветки v1.4.x с CUPS 2.4 — тот путь, которым идёт
  скрипт установки; отдельно воспроизведены обе ошибки macOS-сборки (ветка
  master и отсутствие pkg-config) и проверено, что `--with-tls=openssl` с
  `PKG_CONFIG_PATH` на openssl конфигурируется, когда CUPS виден только через
  `cups-config` — то есть ровно как на маке; проверено и то, что PAPPL
  переносит `CFLAGS`/`LDFLAGS` из `configure` в сборку — на этом держится
  отключение universal-режима;
* CUPS-фильтр прогнан на двухстраничном дуплексном задании из растра CUPS;
* PPD проходит `cupstestppd` без замечаний.

Не проверено: печать на живом P2055 и работа на самой macOS 26 — под рукой не
было ни принтера, ни мака. Ожидаемые места, где может потребоваться правка:
величина непечатаемых полей (сейчас 4 мм по периметру) и коды подачи бумаги для
лотков 1 и 3 — они взяты из спецификации HP PCL5, а конкретная модель может
нумеровать лотки иначе. Обе величины меняются в одном месте: `p2055_callback()`
в `src/p2055_pappl.c` и константы `P2055_SOURCE_*` в `src/p2055_pcl.h`.

## Удаление

Принтер живёт в системе в двух местах: очередь CUPS (её видно в «Принтеры и
сканеры») и принтер внутри printer application. Скрипт снимает оба и убирает
за собой файлы:

```sh
./scripts/uninstall-macos.sh          # спросит подтверждение и покажет список
./scripts/uninstall-macos.sh --queue  # только очередь печати, сервис оставить
```

PAPPL, Homebrew и их пакеты скрипт не трогает — они могли попасть в систему не
из-за драйвера.

Вручную то же самое:

```sh
sudo lpadmin -x HP_LaserJet_P2055                     # очередь печати
p2055-printer-app delete -d p2055                     # принтер в сервисе
p2055-printer-app shutdown                            # остановить сервис
launchctl bootout "gui/$(id -u)/ru.profkosm.p2055-printer-app"
rm ~/Library/LaunchAgents/ru.profkosm.p2055-printer-app.plist
sudo rm /usr/local/bin/p2055-printer-app
rm -f  ~/Library/"Application Support"/p2055-printer-app.state
rm -rf ~/Library/"Application Support"/p2055-printer-app
rm -f  ~/Library/Logs/p2055-printer-app.log ~/Library/Logs/p2055-printer-app.err
```

Если нужно просто пересоздать очередь (например, сменился адрес принтера),
хватит первых двух команд — состояние сервиса и LaunchAgent можно оставить.

## Лицензия и происхождение

Код написан с нуля. Последовательности PCL 5e взяты из HP PCL5 Printer Language
Reference; структура вызовов PAPPL — из документации и примера
[hp-printer-app](https://github.com/michaelrsweet/hp-printer-app) (Apache 2.0).
