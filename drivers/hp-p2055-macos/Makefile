#
# Сборка драйвера HP LaserJet P2055.
#
#   make test      — тесты ядра PCL (собираются на любой ОС, зависимостей нет)
#   make pcldump   — утилита разбора готового потока PCL
#   make app       — printer application на PAPPL (нужен macOS/Linux + PAPPL 1.2+)
#   make filter    — CUPS-фильтр rastertop2055 (нужны заголовки CUPS)
#   make install   — установка printer application в /usr/local (нужен sudo)
#
# На macOS сборка идёт под архитектуру текущей машины (ARCH=arm64 на M-серии);
# переопределяется как make app ARCH=x86_64.
#

CC       ?= cc
CFLAGS   ?= -O2 -g
WARNINGS  = -Wall -Wextra -Werror -Wno-unused-parameter
STD       = -std=c99
PREFIX   ?= /usr/local

# PAPPL ищем через pkg-config; на macOS его обычно нет, поэтому есть запасной
# путь по префиксу установки (Homebrew или /usr/local).
PKGCONFIG     ?= pkg-config
HAVE_PAPPL_PC := $(shell $(PKGCONFIG) --exists pappl 2>/dev/null && echo yes)
PAPPL_PREFIX  ?= $(shell brew --prefix 2>/dev/null || echo /usr/local)

ifeq ($(HAVE_PAPPL_PC),yes)
PAPPL_CFLAGS ?= $(shell $(PKGCONFIG) --cflags pappl)
PAPPL_LIBS   ?= $(shell $(PKGCONFIG) --libs pappl)
else
PAPPL_CFLAGS ?= -I$(PAPPL_PREFIX)/include
PAPPL_LIBS   ?= -L$(PAPPL_PREFIX)/lib -lpappl
endif

# Apple отдаёт через cups-config флаги universal-сборки. На Apple Silicon
# срез x86_64 нечем слинковать: PAPPL и библиотеки Homebrew собраны только
# под arm64, поэтому -arch из этих флагов вырезаем и ставим свой.
CUPS_CFLAGS_RAW := $(shell cups-config --cflags 2>/dev/null)
CUPS_LIBS_RAW   := $(shell cups-config --libs 2>/dev/null || echo -lcups)

CUPS_CFLAGS  ?= $(shell printf '%s' '$(CUPS_CFLAGS_RAW)' | sed -E 's/-arch +[A-Za-z0-9_]+//g')
CUPS_LIBS    ?= $(shell printf '%s' '$(CUPS_LIBS_RAW)' | sed -E 's/-arch +[A-Za-z0-9_]+//g')

UNAME_S := $(shell uname -s)

ifeq ($(UNAME_S),Darwin)
ARCH      ?= $(shell uname -m)
ARCHFLAGS ?= -arch $(ARCH)
else
ARCHFLAGS ?=
endif

all: test

test: build/test_p2055_pcl build/pcldump
	./build/test_p2055_pcl

build:
	mkdir -p build

build/test_p2055_pcl: src/p2055_pcl.c src/p2055_pcl.h tests/test_p2055_pcl.c tests/pcl_decode.c | build
	$(CC) $(STD) $(CFLAGS) $(WARNINGS) -Isrc -Itests -o $@ \
	    src/p2055_pcl.c tests/test_p2055_pcl.c tests/pcl_decode.c -lm

pcldump: build/pcldump

build/pcldump: tests/pcldump.c tests/pcl_decode.c tests/pcl_decode.h | build
	$(CC) $(STD) $(CFLAGS) $(WARNINGS) -Itests -o $@ tests/pcldump.c tests/pcl_decode.c

app: build/p2055-printer-app

build/p2055-printer-app: src/p2055_pappl.c src/p2055_pcl.c src/p2055_pcl.h | build
	$(CC) $(STD) $(CFLAGS) $(ARCHFLAGS) $(WARNINGS) -Isrc $(PAPPL_CFLAGS) $(CUPS_CFLAGS) \
	    -o $@ src/p2055_pappl.c src/p2055_pcl.c $(PAPPL_LIBS) $(CUPS_LIBS) -lm

filter: build/rastertop2055

build/rastertop2055: src/rastertop2055.c src/p2055_pcl.c src/p2055_pcl.h | build
	$(CC) $(STD) $(CFLAGS) $(ARCHFLAGS) $(WARNINGS) -Isrc $(CUPS_CFLAGS) \
	    -o $@ src/rastertop2055.c src/p2055_pcl.c $(CUPS_LIBS) -lm

install: build/p2055-printer-app
	install -d $(DESTDIR)$(PREFIX)/bin
	install -m 755 build/p2055-printer-app $(DESTDIR)$(PREFIX)/bin/p2055-printer-app

install-filter: build/rastertop2055
	install -d $(DESTDIR)$(PREFIX)/libexec/cups/filter
	install -m 755 build/rastertop2055 $(DESTDIR)$(PREFIX)/libexec/cups/filter/rastertop2055
	install -d $(DESTDIR)$(PREFIX)/share/ppd/hp-p2055
	install -m 644 ppd/HP-LaserJet-P2055.ppd $(DESTDIR)$(PREFIX)/share/ppd/hp-p2055/

clean:
	rm -rf build

.PHONY: all test pcldump app filter install install-filter clean
