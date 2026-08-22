/*
 * Генератор потока PCL 5e для HP LaserJet P2055 (серия P2050).
 *
 * Ядро драйвера: ничего не знает ни о CUPS, ни о PAPPL — принимает готовые
 * однобитные строки растра (1 = чёрная точка) и пишет байты PCL в абстрактное
 * устройство. Благодаря этому одна и та же логика используется и в printer
 * application (PAPPL), и в CUPS-фильтре, и покрывается тестами на любой ОС.
 */

#ifndef P2055_PCL_H
#define P2055_PCL_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Коды формата бумаги, ESC & l # A (HP PCL5 Printer Language Reference) */
#define P2055_SIZE_EXECUTIVE    1
#define P2055_SIZE_LETTER       2
#define P2055_SIZE_LEGAL        3
#define P2055_SIZE_JIS_B5      45
#define P2055_SIZE_A5          25
#define P2055_SIZE_A4          26
#define P2055_SIZE_MONARCH     80
#define P2055_SIZE_COM10       81
#define P2055_SIZE_DL          90
#define P2055_SIZE_C5          91
#define P2055_SIZE_ISO_B5     100

/* Коды подачи бумаги, ESC & l # H */
#define P2055_SOURCE_AUTO       7
#define P2055_SOURCE_TRAY1      4   /* многоцелевой лоток 1 */
#define P2055_SOURCE_TRAY2      1   /* основная кассета */
#define P2055_SOURCE_TRAY3      5   /* опциональный лоток 3 */
#define P2055_SOURCE_MANUAL     2

/* Коды типа носителя, ESC & l # M */
#define P2055_TYPE_PLAIN        0
#define P2055_TYPE_BOND         1
#define P2055_TYPE_SPECIAL      2
#define P2055_TYPE_GLOSSY       3
#define P2055_TYPE_TRANSPARENCY 4

#define P2055_DUPLEX_OFF        0
#define P2055_DUPLEX_LONG_EDGE  1   /* переплёт по длинной стороне */
#define P2055_DUPLEX_SHORT_EDGE 2

/* Режимы сжатия растра, ESC * b # M */
#define P2055_COMP_NONE         0
#define P2055_COMP_TIFF         2
#define P2055_COMP_DELTA        3

typedef struct p2055_device_s
{
  /* Возвращает 0 при успехе, -1 при ошибке записи. */
  int (*write)(void *ctx, const void *buf, size_t bytes);
  void *ctx;
} p2055_device_t;

typedef struct p2055_page_s
{
  unsigned width;           /* ширина растра в точках */
  unsigned height;          /* высота растра в точках */
  unsigned resolution;      /* 300 / 600 / 1200 dpi */
  unsigned top_margin_dp;   /* отступ сверху в 1/720 дюйма */
  int      page_size;       /* P2055_SIZE_* */
  int      media_source;    /* P2055_SOURCE_* */
  int      media_type;      /* P2055_TYPE_* */
  int      duplex;          /* P2055_DUPLEX_* */
  int      copies;          /* 1..99 */
  int      economode;       /* 1 — экономия тонера */
} p2055_page_t;

typedef struct p2055_stream_s
{
  p2055_device_t dev;
  unsigned char *seed;      /* последняя переданная строка — seed row для режима 3 */
  unsigned char *tiff;
  unsigned char *delta;
  size_t         linesize;
  size_t         capacity;
  int            last_mode; /* -1 — режим сжатия ещё не задан на этой странице */
  int            seed_valid;
  int            in_page;
  int            duplex;
  unsigned       lines_left;
} p2055_stream_t;

/* Все функции: 0 — успех, -1 — ошибка (запись в устройство или аргументы). */
int  p2055_stream_init(p2055_stream_t *st, const p2055_device_t *dev);
void p2055_stream_free(p2055_stream_t *st);

int  p2055_job_begin(p2055_stream_t *st, const char *job_name, const char *user_name,
                     unsigned resolution, int economode);
int  p2055_job_end(p2055_stream_t *st);

/* page_number нумеруется с единицы: нечётные страницы — лицевые. */
int  p2055_page_begin(p2055_stream_t *st, const p2055_page_t *page, unsigned page_number);
int  p2055_page_line(p2055_stream_t *st, const unsigned char *line, size_t len);
int  p2055_page_end(p2055_stream_t *st, unsigned page_number);

/* Пороговая матрица Байера 16x16 для перевода полутонов в точки.
   gamma > 0 — коррекция под тонер (0.4545 соответствует sRGB). */
void p2055_dither_matrix(unsigned char matrix[16][16], double gamma);

/* Кодеры вынесены в заголовок ради тестов.
   Возвращают длину результата или (size_t)-1, если он не помещается в outmax. */
size_t p2055_compress_tiff(const unsigned char *in, size_t len,
                           unsigned char *out, size_t outmax);
size_t p2055_compress_delta(const unsigned char *cur, const unsigned char *seed, size_t len,
                            unsigned char *out, size_t outmax);
/* Размер буфера, гарантированно достаточный для строки в len байт. */
size_t p2055_compress_bound(size_t len);

#ifdef __cplusplus
}
#endif

#endif /* !P2055_PCL_H */
