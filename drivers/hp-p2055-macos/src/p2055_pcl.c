/*
 * Генератор потока PCL 5e для HP LaserJet P2055. См. p2055_pcl.h.
 */

#include "p2055_pcl.h"

#include <stdarg.h>
#include <stdio.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

#define P2055_MAX_DELTA_RUN 8   /* командный байт режима 3 адресует не более 8 байт замены */


static int
p2055_write(p2055_stream_t *st, const void *buf, size_t bytes)
{
  if (!bytes)
    return (0);

  return (st->dev.write(st->dev.ctx, buf, bytes));
}


static int
p2055_puts(p2055_stream_t *st, const char *s)
{
  return (p2055_write(st, s, strlen(s)));
}


static int
p2055_printf(p2055_stream_t *st, const char *format, ...)
#if defined(__GNUC__) || defined(__clang__)
  __attribute__((format(printf, 2, 3)))
#endif
;

static int
p2055_printf(p2055_stream_t *st, const char *format, ...)
{
  char    buffer[256];
  va_list ap;
  int     len;

  va_start(ap, format);
  len = vsnprintf(buffer, sizeof(buffer), format, ap);
  va_end(ap);

  if (len < 0 || (size_t)len >= sizeof(buffer))
    return (-1);

  return (p2055_write(st, buffer, (size_t)len));
}


/*
 * PJL не переваривает кавычки и управляющие символы в имени задания: строка с
 * ними обрывает разбор команды и принтер уходит в PCL с мусором в буфере.
 */

static void
p2055_sanitize(char *dst, size_t dstsize, const char *src, const char *fallback)
{
  size_t i = 0;

  if (!src || !*src)
    src = fallback;

  while (*src && i < dstsize - 1)
  {
    unsigned char ch = (unsigned char)*src++;

    if (ch < 0x20 || ch == 0x7f || ch == '"' || ch == '\\')
      ch = ' ';

    dst[i++] = (char)ch;
  }

  dst[i] = '\0';
}


/*
 * Матрица строится рекурсивно (M2n = [[4M,4M+2],[4M+3,4M+1]]), чтобы не
 * держать в репозитории чужую таблицу порогов.
 */

void
p2055_dither_matrix(unsigned char matrix[16][16], double gamma)
{
  static const int quadrant[2][2] = { { 0, 2 }, { 3, 1 } };
  int              values[16][16];
  int              size, i, j;

  values[0][0] = 0;

  for (size = 1; size < 16; size *= 2)
    for (i = size * 2 - 1; i >= 0; i--)
      for (j = size * 2 - 1; j >= 0; j--)
        values[i][j] = values[i % size][j % size] * 4 + quadrant[i / size][j / size];

  for (i = 0; i < 16; i++)
    for (j = 0; j < 16; j++)
      matrix[i][j] = gamma > 0.0
                         ? (unsigned char)(255.0 - 255.0 * pow(1.0 - values[i][j] / 255.0, gamma))
                         : (unsigned char)values[i][j];
}


size_t
p2055_compress_bound(size_t len)
{
  /* Худший случай TIFF — литералы по 128 байт с управляющим байтом на каждый
     блок; худший случай delta — командный байт плюс до пяти байт смещения на
     каждые 8 байт замены. */
  size_t tiff  = len + len / 128 + 2;
  size_t delta = len + (len / P2055_MAX_DELTA_RUN + 1) * 6 + 2;

  return (tiff > delta ? tiff : delta);
}


size_t
p2055_compress_tiff(const unsigned char *in, size_t len,
                    unsigned char *out, size_t outmax)
{
  size_t i = 0, o = 0;

  while (i < len)
  {
    size_t run = 1;

    while (i + run < len && in[i + run] == in[i] && run < 128)
      run++;

    if (run > 1)
    {
      if (o + 2 > outmax)
        return ((size_t)-1);

      out[o++] = (unsigned char)(257 - run);
      out[o++] = in[i];
      i += run;
    }
    else
    {
      /* Литеральный блок: копим байты, пока не начнётся серия из трёх
         одинаковых — на паре одинаковых байт разрыв блока не окупается. */
      size_t start = i;

      while (i < len && i - start < 128)
      {
        if (i + 2 < len && in[i] == in[i + 1] && in[i] == in[i + 2])
          break;

        i++;
      }

      if (o + 1 + (i - start) > outmax)
        return ((size_t)-1);

      out[o++] = (unsigned char)(i - start - 1);
      memcpy(out + o, in + start, i - start);
      o += i - start;
    }
  }

  return (o);
}


size_t
p2055_compress_delta(const unsigned char *cur, const unsigned char *seed, size_t len,
                     unsigned char *out, size_t outmax)
{
  size_t i = 0, o = 0, last = 0;

  while (i < len)
  {
    size_t start, run, offset, rest;

    if (cur[i] == seed[i])
    {
      i++;
      continue;
    }

    start = i;
    run   = 0;

    while (i < len && run < P2055_MAX_DELTA_RUN)
    {
      if (cur[i] != seed[i])
      {
        i++;
        run++;
      }
      else if (run + 2 <= P2055_MAX_DELTA_RUN && i + 1 < len && cur[i + 1] != seed[i + 1])
      {
        /* Один совпавший байт внутри серии дешевле нового командного байта. */
        i++;
        run++;
      }
      else
        break;
    }

    offset = start - last;

    if (o + 1 > outmax)
      return ((size_t)-1);

    out[o++] = (unsigned char)(((run - 1) << 5) | (offset < 31 ? offset : 31));

    if (offset >= 31)
    {
      rest = offset - 31;

      while (rest >= 255)
      {
        if (o + 1 > outmax)
          return ((size_t)-1);

        out[o++] = 255;
        rest -= 255;
      }

      if (o + 1 > outmax)
        return ((size_t)-1);

      out[o++] = (unsigned char)rest;
    }

    if (o + run > outmax)
      return ((size_t)-1);

    memcpy(out + o, cur + start, run);
    o   += run;
    last = start + run;
  }

  return (o);
}


int
p2055_stream_init(p2055_stream_t *st, const p2055_device_t *dev)
{
  if (!st || !dev || !dev->write)
    return (-1);

  memset(st, 0, sizeof(*st));
  st->dev       = *dev;
  st->last_mode = -1;

  return (0);
}


void
p2055_stream_free(p2055_stream_t *st)
{
  if (!st)
    return;

  free(st->seed);
  free(st->tiff);
  free(st->delta);

  st->seed     = NULL;
  st->tiff     = NULL;
  st->delta    = NULL;
  st->linesize = 0;
  st->capacity = 0;
}


int
p2055_job_begin(p2055_stream_t *st, const char *job_name, const char *user_name,
                unsigned resolution, int economode)
{
  char name[81], user[81];

  if (!st)
    return (-1);

  if (resolution != 300 && resolution != 600 && resolution != 1200)
    return (-1);

  p2055_sanitize(name, sizeof(name), job_name, "Untitled");
  p2055_sanitize(user, sizeof(user), user_name, "unknown");

  if (p2055_puts(st, "\033%-12345X"))
    return (-1);
  if (p2055_printf(st, "@PJL JOB NAME=\"%s\"\r\n", name))
    return (-1);
  if (p2055_printf(st, "@PJL SET USERNAME=\"%s\"\r\n", user))
    return (-1);
  if (p2055_printf(st, "@PJL SET RESOLUTION=%u\r\n", resolution))
    return (-1);
  if (p2055_printf(st, "@PJL SET ECONOMODE=%s\r\n", economode ? "ON" : "OFF"))
    return (-1);
  if (p2055_puts(st, "@PJL ENTER LANGUAGE=PCL\r\n"))
    return (-1);

  return (p2055_puts(st, "\033E"));
}


int
p2055_job_end(p2055_stream_t *st)
{
  if (!st)
    return (-1);

  if (p2055_puts(st, "\033E"))
    return (-1);

  return (p2055_puts(st, "\033%-12345X@PJL EOJ\r\n\033%-12345X"));
}


int
p2055_page_begin(p2055_stream_t *st, const p2055_page_t *page, unsigned page_number)
{
  size_t linesize, capacity;
  int    front;

  if (!st || !page || !page->width || !page->height || st->in_page)
    return (-1);

  if (page->resolution != 300 && page->resolution != 600 && page->resolution != 1200)
    return (-1);

  linesize = (page->width + 7) / 8;
  capacity = p2055_compress_bound(linesize);

  if (linesize != st->linesize || !st->seed)
  {
    unsigned char *seed  = realloc(st->seed, linesize);
    unsigned char *tiff  = realloc(st->tiff, capacity);
    unsigned char *delta = realloc(st->delta, capacity);

    if (!seed || !tiff || !delta)
    {
      /* realloc мог удаться частично — сохраняем то, что получилось, иначе
         следующий free() ушёл бы по старому, уже освобождённому указателю. */
      if (seed)
        st->seed = seed;
      if (tiff)
        st->tiff = tiff;
      if (delta)
        st->delta = delta;

      return (-1);
    }

    st->seed     = seed;
    st->tiff     = tiff;
    st->delta    = delta;
    st->linesize = linesize;
    st->capacity = capacity;
  }

  memset(st->seed, 0, linesize);
  st->seed_valid = 0;
  st->last_mode  = -1;
  st->duplex     = page->duplex;
  st->lines_left = page->height;

  front = page->duplex == P2055_DUPLEX_OFF || (page_number & 1);

  if (front)
  {
    if (p2055_printf(st, "\033&l%dH", page->media_source))
      return (-1);
    if (p2055_puts(st, "\033&l0O"))                       /* книжная ориентация */
      return (-1);
    if (p2055_printf(st, "\033&l%dA", page->page_size))
      return (-1);
    if (p2055_printf(st, "\033&l%dM", page->media_type))
      return (-1);
    if (p2055_puts(st, "\033&l0E\033&l0L"))               /* поле сверху 0, пропуск перфорации off */
      return (-1);
    if (p2055_printf(st, "\033&l%dS", page->duplex))
      return (-1);
    if (p2055_printf(st, "\033&l%dX", page->copies > 0 ? page->copies : 1))
      return (-1);
  }
  else if (p2055_puts(st, "\033&a2G"))                    /* печать на обороте листа */
    return (-1);

  if (p2055_printf(st, "\033*t%uR", page->resolution))
    return (-1);
  if (p2055_printf(st, "\033*r%uS\033*r%uT", page->width, page->height))
    return (-1);
  if (p2055_printf(st, "\033&a0H\033&a%uV", page->top_margin_dp))
    return (-1);
  if (p2055_puts(st, "\033*r1A"))                         /* растр с текущей позиции курсора */
    return (-1);

  st->in_page = 1;

  return (0);
}


int
p2055_page_line(p2055_stream_t *st, const unsigned char *line, size_t len)
{
  size_t               tiff_len, delta_len, raw_len;
  size_t               best_len;
  int                  best_mode;
  const unsigned char *best_data;

  if (!st || !st->in_page || !line || len != st->linesize)
    return (-1);

  /* Хвостовые нулевые байты можно не передавать: принтер добивает строку
     нулями сам. В режиме 3 это не работает — незатронутые байты берутся из
     seed row, а не обнуляются. */
  raw_len = len;
  while (raw_len > 0 && line[raw_len - 1] == 0)
    raw_len--;

  best_mode = P2055_COMP_NONE;
  best_len  = raw_len;
  best_data = line;

  tiff_len = p2055_compress_tiff(line, raw_len, st->tiff, st->capacity);

  if (tiff_len != (size_t)-1 && tiff_len < best_len)
  {
    best_mode = P2055_COMP_TIFF;
    best_len  = tiff_len;
    best_data = st->tiff;
  }

  if (st->seed_valid)
  {
    delta_len = p2055_compress_delta(line, st->seed, len, st->delta, st->capacity);

    if (delta_len != (size_t)-1 && delta_len < best_len)
    {
      best_mode = P2055_COMP_DELTA;
      best_len  = delta_len;
      best_data = st->delta;
    }
  }

  if (best_mode != st->last_mode)
  {
    if (p2055_printf(st, "\033*b%dM", best_mode))
      return (-1);

    st->last_mode = best_mode;
  }

  if (p2055_printf(st, "\033*b%zuW", best_len))
    return (-1);

  if (p2055_write(st, best_data, best_len))
    return (-1);

  memcpy(st->seed, line, len);
  st->seed_valid = 1;

  if (st->lines_left)
    st->lines_left--;

  return (0);
}


int
p2055_page_end(p2055_stream_t *st, unsigned page_number)
{
  if (!st || !st->in_page)
    return (-1);

  st->in_page = 0;

  if (p2055_puts(st, "\033*rC"))
    return (-1);

  /* В дуплексе лист выезжает после оборотной стороны, лицевую не выталкиваем. */
  if (st->duplex != P2055_DUPLEX_OFF && (page_number & 1))
    return (0);

  return (p2055_puts(st, "\014"));
}
