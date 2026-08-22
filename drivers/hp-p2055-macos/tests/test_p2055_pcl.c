/*
 * Тесты генератора PCL 5e.
 *
 * Проверяем не «байт в байт совпало с эталоном», а обратимость: поток
 * разбирается встроенным декодером PCL и восстановленный растр сравнивается
 * с исходным. Так тест не ломается от смены режима сжатия, но ловит реальные
 * ошибки кодеров.
 */

#include "p2055_pcl.h"
#include "pcl_decode.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int tests_run  = 0;
static int tests_fail = 0;

#define CHECK(cond, ...)                                     \
  do {                                                       \
    tests_run++;                                             \
    if (!(cond))                                             \
    {                                                        \
      tests_fail++;                                          \
      printf("  FAIL %s:%d: ", __FILE__, __LINE__);          \
      printf(__VA_ARGS__);                                   \
      printf("\n");                                          \
    }                                                        \
  } while (0)


/* ----------------------------------------------------------------- буфер */

typedef struct
{
  unsigned char *data;
  size_t         len;
  size_t         cap;
  int            fail_after;   /* -1 — писать всегда, иначе отказ после N байт */
} sink_t;

static int
sink_write(void *ctx, const void *buf, size_t bytes)
{
  sink_t *sink = (sink_t *)ctx;

  if (sink->fail_after >= 0 && sink->len + bytes > (size_t)sink->fail_after)
    return (-1);

  if (sink->len + bytes > sink->cap)
  {
    size_t         cap  = (sink->cap ? sink->cap * 2 : 4096) + bytes;
    unsigned char *data = realloc(sink->data, cap);

    if (!data)
      return (-1);

    sink->data = data;
    sink->cap  = cap;
  }

  memcpy(sink->data + sink->len, buf, bytes);
  sink->len += bytes;

  return (0);
}

static void
sink_init(sink_t *sink)
{
  memset(sink, 0, sizeof(*sink));
  sink->fail_after = -1;
}


/* ------------------------------------------------------------- сценарии */

static unsigned
rng_next(unsigned *state)
{
  *state = *state * 1103515245u + 12345u;
  return (*state >> 16);
}


static void
test_tiff_roundtrip(void)
{
  unsigned state = 1;
  size_t   len;

  printf("TIFF (режим 2), обратимость и границы:\n");

  for (len = 0; len <= 300; len++)
  {
    unsigned char in[300], out[1024], back[512];
    size_t        clen, dlen, i;

    for (i = 0; i < len; i++)
    {
      unsigned r = rng_next(&state) % 100;

      /* Смесь серий и шума — обе ветки кодера должны отработать. */
      in[i] = r < 60 ? 0 : (r < 80 ? 0xff : (unsigned char)rng_next(&state));
    }

    clen = p2055_compress_tiff(in, len, out, sizeof(out));

    if (clen == (size_t)-1)
    {
      CHECK(0, "len=%zu: кодер сообщил о нехватке буфера", len);
      continue;
    }

    CHECK(clen <= p2055_compress_bound(len), "len=%zu: %zu байт превышает bound %zu",
          len, clen, p2055_compress_bound(len));

    dlen = pcl_decode_tiff(out, clen, back, sizeof(back));

    CHECK(dlen == len && (len == 0 || !memcmp(in, back, len)),
          "len=%zu: декодировано %zu байт, данные не совпали", len, dlen);
  }

  {
    unsigned char in[256], out[8];

    memset(in, 0x5a, sizeof(in));
    for (size_t i = 0; i < sizeof(in); i += 2)
      in[i] = (unsigned char)i;

    CHECK(p2055_compress_tiff(in, sizeof(in), out, sizeof(out)) == (size_t)-1,
          "переполнение выходного буфера не обнаружено");
  }
}


static void
test_delta_roundtrip(void)
{
  unsigned state = 7;
  int      round;

  printf("Delta row (режим 3), обратимость и границы:\n");

  for (round = 0; round < 200; round++)
  {
    unsigned char seed[600], cur[600], row[600], out[4096];
    size_t        len = 1 + (size_t)(rng_next(&state) % 600);
    size_t        clen, i;
    unsigned      density = rng_next(&state) % 101;

    for (i = 0; i < len; i++)
    {
      seed[i] = (unsigned char)rng_next(&state);
      cur[i]  = (rng_next(&state) % 100) < density ? (unsigned char)rng_next(&state) : seed[i];
    }

    clen = p2055_compress_delta(cur, seed, len, out, sizeof(out));

    if (clen == (size_t)-1)
    {
      CHECK(0, "round=%d len=%zu: кодер сообщил о нехватке буфера", round, len);
      continue;
    }

    CHECK(clen <= p2055_compress_bound(len), "round=%d: %zu байт превышает bound %zu",
          round, clen, p2055_compress_bound(len));

    memcpy(row, seed, len);

    CHECK(pcl_decode_delta(out, clen, row, len) == 0, "round=%d: поток не разобрался", round);
    CHECK(!memcmp(row, cur, len), "round=%d len=%zu: строка восстановлена неверно", round, len);
  }

  /* Совпадающие строки — пустой выход, принтер повторит seed row. */
  {
    unsigned char seed[64], out[128];

    memset(seed, 0xa5, sizeof(seed));
    CHECK(p2055_compress_delta(seed, seed, sizeof(seed), out, sizeof(out)) == 0,
          "совпадающие строки должны кодироваться нулём байт");
  }

  /* Смещение > 30 (нужен расширенный байт) и > 255 (цепочка байт 255). */
  {
    unsigned char seed[1200], cur[1200], row[1200], out[4096];
    size_t        clen;

    memset(seed, 0, sizeof(seed));
    memset(cur, 0, sizeof(cur));
    cur[40]   = 0x11;   /* смещение 40  -> один дополнительный байт */
    cur[1100] = 0x22;   /* смещение 1059 -> цепочка из четырёх 255 + остаток */

    clen = p2055_compress_delta(cur, seed, sizeof(cur), out, sizeof(out));

    CHECK(clen != (size_t)-1, "длинные смещения: кодер не справился");

    memcpy(row, seed, sizeof(seed));
    CHECK(pcl_decode_delta(out, clen, row, sizeof(row)) == 0, "длинные смещения: поток не разобрался");
    CHECK(!memcmp(row, cur, sizeof(cur)), "длинные смещения: строка восстановлена неверно");
  }

  /* Одна отличающаяся точка в самом конце длинной строки. */
  {
    unsigned char seed[1240], cur[1240], row[1240], out[4096];
    size_t        clen;

    memset(seed, 0, sizeof(seed));
    memset(cur, 0, sizeof(cur));
    cur[sizeof(cur) - 1] = 0x01;

    clen = p2055_compress_delta(cur, seed, sizeof(cur), out, sizeof(out));
    memcpy(row, seed, sizeof(seed));

    CHECK(clen != (size_t)-1 && pcl_decode_delta(out, clen, row, sizeof(row)) == 0 &&
          !memcmp(row, cur, sizeof(cur)), "последний байт строки не восстановился");
  }

  /* Полностью различающиеся строки: серии по 8 байт, выход длиннее входа. */
  {
    unsigned char seed[64], cur[64], row[64], out[256];
    size_t        clen, i;

    for (i = 0; i < sizeof(seed); i++)
    {
      seed[i] = 0x00;
      cur[i]  = 0xff;
    }

    clen = p2055_compress_delta(cur, seed, sizeof(cur), out, sizeof(out));
    memcpy(row, seed, sizeof(seed));

    CHECK(clen == 72, "ожидалось 8 команд по 9 байт, получено %zu", clen);
    CHECK(pcl_decode_delta(out, clen, row, sizeof(row)) == 0 && !memcmp(row, cur, sizeof(cur)),
          "сплошное различие восстановилось неверно");
  }

  {
    unsigned char seed[64], cur[64], out[4];

    memset(seed, 0, sizeof(seed));
    memset(cur, 0xff, sizeof(cur));

    CHECK(p2055_compress_delta(cur, seed, sizeof(cur), out, sizeof(out)) == (size_t)-1,
          "переполнение выходного буфера не обнаружено");
  }
}


/* Рисует тестовый растр: рамка, диагональ, полосы и пустые строки. */
static void
make_bitmap(unsigned char *bits, unsigned width, unsigned height, unsigned seed_value)
{
  size_t   linesize = (width + 7) / 8;
  unsigned x, y;
  unsigned state = seed_value;

  memset(bits, 0, linesize * height);

  for (y = 0; y < height; y++)
  {
    unsigned char *row = bits + (size_t)y * linesize;

    if (y % 7 == 3)
      continue;                      /* пустые строки — проверка режима 3 */

    for (x = 0; x < width; x++)
    {
      int black = 0;

      if (y == 0 || y == height - 1 || x == 0 || x == width - 1)
        black = 1;                   /* рамка */
      else if (x == y % width)
        black = 1;                   /* диагональ */
      else if (y % 11 == 0)
        black = 1;                   /* сплошная полоса — серии для режима 2 */
      else if (y % 13 == 0)
        black = (int)(rng_next(&state) & 1);

      if (black)
        row[x / 8] |= (unsigned char)(0x80 >> (x % 8));
    }
  }
}


static void
test_page_roundtrip(void)
{
  static const struct
  {
    unsigned width, height, resolution;
  } cases[] =
  {
    {    1,    1,  600 },   /* минимальный растр */
    {    8,    4,  300 },
    { 4960, 7016,  600 },   /* A4 при 600 dpi */
    { 1240,   64, 1200 }
  };
  size_t c;

  printf("Страница целиком, обратимость растра:\n");

  for (c = 0; c < sizeof(cases) / sizeof(cases[0]); c++)
  {
    sink_t          sink;
    p2055_stream_t  st;
    p2055_device_t  dev;
    p2055_page_t    page;
    pcl_stream_t      parsed;
    unsigned char  *bits;
    size_t          linesize = (cases[c].width + 7) / 8;
    unsigned        y;
    int             ok = 1;

    bits = malloc(linesize * cases[c].height);
    make_bitmap(bits, cases[c].width, cases[c].height, (unsigned)c + 1);

    sink_init(&sink);
    dev.write = sink_write;
    dev.ctx   = &sink;

    memset(&page, 0, sizeof(page));
    page.width         = cases[c].width;
    page.height        = cases[c].height;
    page.resolution    = cases[c].resolution;
    page.page_size     = P2055_SIZE_A4;
    page.media_source  = P2055_SOURCE_AUTO;
    page.media_type    = P2055_TYPE_PLAIN;
    page.duplex        = P2055_DUPLEX_OFF;
    page.copies        = 1;
    page.top_margin_dp = 120;

    CHECK(p2055_stream_init(&st, &dev) == 0, "инициализация потока");
    CHECK(p2055_job_begin(&st, "Тест \"кавычки\"\n", "user", cases[c].resolution, 0) == 0,
          "начало задания");
    CHECK(p2055_page_begin(&st, &page, 1) == 0, "начало страницы");

    for (y = 0; y < cases[c].height; y++)
      if (p2055_page_line(&st, bits + (size_t)y * linesize, linesize))
      {
        ok = 0;
        break;
      }

    CHECK(ok, "%ux%u: строка не записалась", cases[c].width, cases[c].height);
    CHECK(p2055_page_end(&st, 1) == 0, "конец страницы");
    CHECK(p2055_job_end(&st) == 0, "конец задания");

    pcl_parse(sink.data, sink.len, &parsed);

    CHECK(!parsed.error, "%ux%u: поток не разобрался", cases[c].width, cases[c].height);
    CHECK(parsed.has_pjl_enter, "нет обвязки PJL");
    CHECK(parsed.resets == 2, "ожидалось два ESC E, получено %d", parsed.resets);
    CHECK(parsed.width == cases[c].width, "ширина растра %u вместо %u", parsed.width, cases[c].width);
    CHECK(parsed.resolution == (int)cases[c].resolution, "разрешение %d вместо %u",
          parsed.resolution, cases[c].resolution);
    CHECK(parsed.page_size == P2055_SIZE_A4, "формат %d вместо A4", parsed.page_size);
    CHECK(parsed.form_feeds == 1, "ожидался один перевод страницы, получено %d", parsed.form_feeds);
    CHECK(parsed.raster_ends == 1, "растр не закрыт (%d)", parsed.raster_ends);
    CHECK(parsed.num_rows == cases[c].height, "%ux%u: строк %zu вместо %u",
          cases[c].width, cases[c].height, parsed.num_rows, cases[c].height);

    if (!parsed.error && parsed.num_rows == cases[c].height)
    {
      size_t bad = 0;

      for (y = 0; y < cases[c].height; y++)
        if (memcmp(parsed.rows[y], bits + (size_t)y * linesize, linesize))
          bad++;

      CHECK(bad == 0, "%ux%u: не совпало строк: %zu", cases[c].width, cases[c].height, bad);
    }

    if (cases[c].width == 4960)
      printf("  A4/600dpi: %zu байт на страницу (%.1f%% от несжатого)\n",
             sink.len, 100.0 * (double)sink.len / (double)(linesize * cases[c].height));

    pcl_stream_free(&parsed);
    p2055_stream_free(&st);
    free(sink.data);
    free(bits);
  }
}


static void
test_blank_page(void)
{
  sink_t         sink;
  p2055_stream_t st;
  p2055_device_t dev;
  p2055_page_t   page;
  pcl_stream_t     parsed;
  unsigned char  blank[620];
  unsigned       y;
  int            ok = 1;

  printf("Пустая страница:\n");

  memset(blank, 0, sizeof(blank));
  sink_init(&sink);
  dev.write = sink_write;
  dev.ctx   = &sink;

  memset(&page, 0, sizeof(page));
  page.width        = 4960;
  page.height       = 7016;
  page.resolution   = 600;
  page.page_size    = P2055_SIZE_A4;
  page.media_source = P2055_SOURCE_TRAY2;
  page.copies       = 1;

  p2055_stream_init(&st, &dev);
  p2055_job_begin(&st, "blank", "user", 600, 0);
  p2055_page_begin(&st, &page, 1);

  for (y = 0; y < page.height; y++)
    if (p2055_page_line(&st, blank, sizeof(blank)))
      ok = 0;

  p2055_page_end(&st, 1);
  p2055_job_end(&st);

  CHECK(ok, "строки пустой страницы не записались");

  pcl_parse(sink.data, sink.len, &parsed);

  CHECK(!parsed.error && parsed.num_rows == page.height,
        "пустая страница: строк %zu вместо %u", parsed.num_rows, page.height);
  CHECK(sink.len < 80000, "пустая страница заняла %zu байт — сжатие не работает", sink.len);

  printf("  пустая A4/600dpi: %zu байт\n", sink.len);

  pcl_stream_free(&parsed);
  p2055_stream_free(&st);
  free(sink.data);
}


static void
test_duplex(void)
{
  sink_t         sink;
  p2055_stream_t st;
  p2055_device_t dev;
  p2055_page_t   page;
  pcl_stream_t     parsed;
  unsigned char  line[8];
  unsigned       p, y;

  printf("Дуплекс:\n");

  memset(line, 0x0f, sizeof(line));
  sink_init(&sink);
  dev.write = sink_write;
  dev.ctx   = &sink;

  memset(&page, 0, sizeof(page));
  page.width        = 64;
  page.height       = 4;
  page.resolution   = 600;
  page.page_size    = P2055_SIZE_LETTER;
  page.media_source = P2055_SOURCE_TRAY2;
  page.duplex       = P2055_DUPLEX_LONG_EDGE;
  page.copies       = 2;

  p2055_stream_init(&st, &dev);
  p2055_job_begin(&st, "duplex", "user", 600, 1);

  for (p = 1; p <= 4; p++)
  {
    CHECK(p2055_page_begin(&st, &page, p) == 0, "начало страницы %u", p);

    for (y = 0; y < page.height; y++)
      p2055_page_line(&st, line, sizeof(line));

    CHECK(p2055_page_end(&st, p) == 0, "конец страницы %u", p);
  }

  p2055_job_end(&st);
  pcl_parse(sink.data, sink.len, &parsed);

  CHECK(!parsed.error, "поток дуплекса не разобрался");
  CHECK(parsed.form_feeds == 2, "на 4 страницы дуплекса нужно 2 выброса листа, получено %d",
        parsed.form_feeds);
  CHECK(parsed.backsides == 2, "команд печати на обороте %d вместо 2", parsed.backsides);
  CHECK(parsed.duplex == P2055_DUPLEX_LONG_EDGE, "режим дуплекса %d", parsed.duplex);
  CHECK(parsed.copies == 2, "число копий %d вместо 2", parsed.copies);
  CHECK(strstr((const char *)sink.data, "@PJL SET ECONOMODE=ON") != NULL,
        "ECONOMODE не попал в PJL");

  pcl_stream_free(&parsed);
  p2055_stream_free(&st);
  free(sink.data);
}


static void
test_invalid_input(void)
{
  sink_t         sink;
  p2055_stream_t st;
  p2055_device_t dev;
  p2055_page_t   page;
  unsigned char  line[8];

  printf("Некорректные аргументы и ошибки записи:\n");

  sink_init(&sink);
  dev.write = sink_write;
  dev.ctx   = &sink;

  memset(line, 0, sizeof(line));
  memset(&page, 0, sizeof(page));
  page.width      = 64;
  page.height     = 4;
  page.resolution = 600;
  page.page_size  = P2055_SIZE_A4;
  page.copies     = 1;

  CHECK(p2055_stream_init(&st, NULL) == -1, "init без устройства должен падать");
  CHECK(p2055_stream_init(&st, &dev) == 0, "init");

  CHECK(p2055_job_begin(&st, "x", "y", 723, 0) == -1, "неподдержанное разрешение принято");
  CHECK(p2055_page_line(&st, line, sizeof(line)) == -1, "строка вне страницы принята");
  CHECK(p2055_page_end(&st, 1) == -1, "конец несуществующей страницы принят");

  CHECK(p2055_job_begin(&st, NULL, NULL, 600, 0) == 0, "начало задания без имени");

  page.width = 0;
  CHECK(p2055_page_begin(&st, &page, 1) == -1, "нулевая ширина принята");
  page.width      = 64;
  page.resolution = 400;
  CHECK(p2055_page_begin(&st, &page, 1) == -1, "разрешение 400 dpi принято");
  page.resolution = 600;

  CHECK(p2055_page_begin(&st, &page, 1) == 0, "начало страницы");
  CHECK(p2055_page_begin(&st, &page, 2) == -1, "вложенная страница принята");
  CHECK(p2055_page_line(&st, line, 7) == -1, "строка неверной длины принята");
  CHECK(p2055_page_line(&st, NULL, sizeof(line)) == -1, "NULL-строка принята");
  CHECK(p2055_page_line(&st, line, sizeof(line)) == 0, "корректная строка");

  p2055_stream_free(&st);
  free(sink.data);

  /* Ошибка устройства должна дойти до вызывающего, а не потеряться. */
  {
    sink_t         bad;
    p2055_stream_t st2;
    p2055_device_t dev2;
    int            got_error = 0;
    unsigned       y;

    sink_init(&bad);
    bad.fail_after = 200;
    dev2.write     = sink_write;
    dev2.ctx       = &bad;

    p2055_stream_init(&st2, &dev2);

    if (p2055_job_begin(&st2, "fail", "user", 600, 0))
      got_error = 1;
    if (p2055_page_begin(&st2, &page, 1))
      got_error = 1;

    for (y = 0; y < 100; y++)
      if (p2055_page_line(&st2, line, sizeof(line)))
        got_error = 1;

    CHECK(got_error, "ошибка записи в устройство не была возвращена");

    p2055_stream_free(&st2);
    free(bad.data);
  }
}


static void
test_dither_matrix(void)
{
  unsigned char matrix[16][16], gamma_matrix[16][16];
  int           seen[256], gamma_map[256];
  int           i, j, missing = 0, gamma_ok = 1, monotonic = 1;

  printf("Матрица растрирования:\n");

  memset(seen, 0, sizeof(seen));
  memset(gamma_map, 0, sizeof(gamma_map));
  p2055_dither_matrix(matrix, 0.0);
  p2055_dither_matrix(gamma_matrix, 0.4545);

  for (i = 0; i < 16; i++)
    for (j = 0; j < 16; j++)
    {
      seen[matrix[i][j]]++;

      /* Гамма-коррекция опускает пороги (лазер печатает темнее), но не
         переставляет их: порог должен остаться монотонным по исходному. */
      gamma_map[matrix[i][j]] = gamma_matrix[i][j];

      if (gamma_matrix[i][j] > matrix[i][j])
        gamma_ok = 0;
    }

  for (i = 0; i < 256; i++)
    if (seen[i] != 1)
      missing++;

  for (i = 1; i < 256; i++)
    if (gamma_map[i] < gamma_map[i - 1])
      monotonic = 0;

  CHECK(missing == 0, "матрица не является перестановкой 0..255 (%d значений не на месте)", missing);
  CHECK(gamma_ok, "гамма-коррекция подняла пороги вместо понижения");
  CHECK(monotonic, "гамма-коррекция переставила пороги местами");
  CHECK(gamma_map[0] == 0 && gamma_map[255] == 255, "гамма-коррекция сдвинула крайние пороги");
}


int
main(void)
{
  test_dither_matrix();
  test_tiff_roundtrip();
  test_delta_roundtrip();
  test_page_roundtrip();
  test_blank_page();
  test_duplex();
  test_invalid_input();

  printf("\nпроверок: %d, провалов: %d\n", tests_run, tests_fail);

  return (tests_fail ? 1 : 0);
}
