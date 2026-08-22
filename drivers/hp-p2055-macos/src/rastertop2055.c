/*
 * rastertop2055 — CUPS-фильтр: растр CUPS -> PCL 5e для HP LaserJet P2055.
 *
 * Запасной путь для систем, где ещё работают классические очереди с PPD
 * (Linux, старые macOS). На macOS 26 основной путь — printer application,
 * см. README.
 *
 * Вызывается CUPS: rastertop2055 job user title copies options [file]
 */

#define _POSIX_C_SOURCE 200809L

#include <cups/cups.h>
#include <cups/raster.h>

#include <fcntl.h>
#include <math.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <unistd.h>

#include "p2055_pcl.h"

#if CUPS_VERSION_MAJOR < 3
#  define cups_page_header_t cups_page_header2_t
#  define cupsRasterReadHeader cupsRasterReadHeader2
#endif


typedef struct
{
  const char *keyword;
  int         value;
} p2055_map_t;

static const p2055_map_t p2055_sizes[] =
{
  { "A4",         P2055_SIZE_A4 },
  { "A5",         P2055_SIZE_A5 },
  { "Letter",     P2055_SIZE_LETTER },
  { "Legal",      P2055_SIZE_LEGAL },
  { "Executive",  P2055_SIZE_EXECUTIVE },
  { "B5",         P2055_SIZE_JIS_B5 },
  { "ISOB5",      P2055_SIZE_ISO_B5 },
  { "Env10",      P2055_SIZE_COM10 },
  { "EnvC5",      P2055_SIZE_C5 },
  { "EnvDL",      P2055_SIZE_DL },
  { "EnvMonarch", P2055_SIZE_MONARCH }
};

static const p2055_map_t p2055_types[] =
{
  { "Plain",        P2055_TYPE_PLAIN },
  { "Bond",         P2055_TYPE_BOND },
  { "Cardstock",    P2055_TYPE_SPECIAL },
  { "Labels",       P2055_TYPE_SPECIAL },
  { "Envelope",     P2055_TYPE_SPECIAL },
  { "Transparency", P2055_TYPE_TRANSPARENCY }
};

static volatile sig_atomic_t job_canceled = 0;


static void
cancel_job(int sig)
{
  (void)sig;
  job_canceled = 1;
}


static int
stdout_write(void *ctx, const void *buf, size_t bytes)
{
  (void)ctx;

  return (fwrite(buf, 1, bytes, stdout) == bytes ? 0 : -1);
}


static int
lookup(const p2055_map_t *map, size_t count, const char *keyword, int fallback)
{
  size_t i;

  if (keyword && *keyword)
    for (i = 0; i < count; i++)
      if (!strcmp(keyword, map[i].keyword))
        return (map[i].value);

  return (fallback);
}


/* Растр CUPS может приходить как 1 бит на точку или как 8-битный полутон. */
static void
pack_line(const cups_page_header_t *header, const unsigned char *pixels,
          const unsigned char dither[16][16], unsigned y,
          unsigned char *out, size_t linesize)
{
  unsigned      x;
  unsigned char bit;

  if (header->cupsBitsPerPixel == 1)
  {
    size_t bytes = header->cupsBytesPerLine < linesize ? header->cupsBytesPerLine : linesize;

    memcpy(out, pixels, bytes);

    if (bytes < linesize)
      memset(out + bytes, 0, linesize - bytes);

    if (header->cupsColorSpace != CUPS_CSPACE_K)
      for (x = 0; x < linesize; x++)
        out[x] = (unsigned char)~out[x];

    return;
  }

  memset(out, 0, linesize);

  for (x = 0, bit = 128; x < header->cupsWidth; x++)
  {
    unsigned value = header->cupsColorSpace == CUPS_CSPACE_K ? pixels[x] : 255u - pixels[x];

    if (value >= dither[y & 15][x & 15])
      out[x / 8] |= bit;

    bit = bit > 1 ? bit / 2 : 128;
  }
}


int
main(int argc, char *argv[])
{
  int                fd = 0;
  cups_raster_t     *ras;
  cups_page_header_t header;
  p2055_stream_t     stream;
  p2055_device_t     dev;
  unsigned char     *pixels = NULL, *line = NULL, dither[16][16];
  size_t             linesize = 0, pixelsize = 0;
  unsigned           page = 0, y;
  int                num_options;
  cups_option_t     *options = NULL;
  const char        *value;
  int                status = 0;
  struct sigaction   action;

  if (argc < 6 || argc > 7)
  {
    fputs("ERROR: rastertop2055 job user title copies options [file]\n", stderr);
    return (1);
  }

  if (argc == 7)
  {
    if ((fd = open(argv[6], O_RDONLY)) < 0)
    {
      fprintf(stderr, "ERROR: Не удалось открыть %s\n", argv[6]);
      return (1);
    }
  }

  memset(&action, 0, sizeof(action));
  sigemptyset(&action.sa_mask);
  action.sa_handler = cancel_job;
  sigaction(SIGTERM, &action, NULL);

  num_options = cupsParseOptions(argv[5], 0, &options);

  p2055_dither_matrix(dither, 0.4545);

  dev.write = stdout_write;
  dev.ctx   = NULL;

  if (p2055_stream_init(&stream, &dev))
  {
    fputs("ERROR: Не удалось инициализировать поток PCL.\n", stderr);
    cupsFreeOptions(num_options, options);
    return (1);
  }

  ras = cupsRasterOpen(fd, CUPS_RASTER_READ);

  while (!job_canceled && cupsRasterReadHeader(ras, &header))
  {
    p2055_page_t pcl_page;
    unsigned     top_points;

    if (!header.cupsWidth || !header.cupsHeight ||
        (header.cupsBitsPerPixel != 1 && header.cupsBitsPerPixel != 8))
    {
      fputs("ERROR: Драйвер принимает только чёрно-белый растр 1 или 8 бит на точку.\n", stderr);
      status = 1;
      break;
    }

    page++;
    fprintf(stderr, "PAGE: %u %u\n", page, header.NumCopies ? header.NumCopies : 1);
    fprintf(stderr, "INFO: Страница %u, %ux%u точек при %u dpi\n",
            page, header.cupsWidth, header.cupsHeight, header.HWResolution[0]);

    if (page == 1)
    {
      /* Экономрежим приходит либо из PPD (cupsInteger0), либо опцией задания. */
      int economode = header.cupsInteger[0] != 0;

      if ((value = cupsGetOption("Economode", num_options, options)) != NULL)
        economode = !strcasecmp(value, "true") || !strcasecmp(value, "on") ||
                    !strcasecmp(value, "yes");

      if (p2055_job_begin(&stream, argv[3], argv[2], header.HWResolution[0], economode))
      {
        fputs("ERROR: Обрыв записи в принтер.\n", stderr);
        status = 1;
        break;
      }
    }

    /* Растр приходит по размеру печатаемой области — смещаем его вниз на
       величину верхнего непечатаемого поля, иначе страница уедет вверх. */
    top_points = header.PageSize[1] > header.ImagingBoundingBox[3]
                     ? header.PageSize[1] - header.ImagingBoundingBox[3]
                     : 0;

    memset(&pcl_page, 0, sizeof(pcl_page));
    pcl_page.width         = header.cupsWidth;
    pcl_page.height        = header.cupsHeight;
    pcl_page.resolution    = header.HWResolution[0];
    pcl_page.top_margin_dp = top_points * 10;
    pcl_page.copies        = header.NumCopies ? (int)header.NumCopies : 1;
    pcl_page.page_size     = lookup(p2055_sizes, sizeof(p2055_sizes) / sizeof(p2055_sizes[0]),
                                    header.cupsPageSizeName[0] ? header.cupsPageSizeName : NULL,
                                    P2055_SIZE_A4);
    pcl_page.media_type    = lookup(p2055_types, sizeof(p2055_types) / sizeof(p2055_types[0]),
                                    header.MediaType, P2055_TYPE_PLAIN);
    pcl_page.media_source  = header.MediaPosition ? (int)header.MediaPosition : P2055_SOURCE_AUTO;
    pcl_page.duplex        = header.Duplex ? (header.Tumble ? P2055_DUPLEX_SHORT_EDGE
                                                            : P2055_DUPLEX_LONG_EDGE)
                                           : P2055_DUPLEX_OFF;

    linesize = (header.cupsWidth + 7) / 8;

    if (header.cupsBytesPerLine > pixelsize)
    {
      unsigned char *tmp = realloc(pixels, header.cupsBytesPerLine);

      if (!tmp)
      {
        fputs("ERROR: Не хватило памяти под строку растра.\n", stderr);
        status = 1;
        break;
      }

      pixels    = tmp;
      pixelsize = header.cupsBytesPerLine;
    }

    {
      unsigned char *tmp = realloc(line, linesize);

      if (!tmp)
      {
        fputs("ERROR: Не хватило памяти под строку PCL.\n", stderr);
        status = 1;
        break;
      }

      line = tmp;
    }

    if (p2055_page_begin(&stream, &pcl_page, page))
    {
      fputs("ERROR: Обрыв записи в принтер.\n", stderr);
      status = 1;
      break;
    }

    for (y = 0; y < header.cupsHeight; y++)
    {
      if (job_canceled)
        break;

      if (cupsRasterReadPixels(ras, pixels, header.cupsBytesPerLine) < header.cupsBytesPerLine)
      {
        fprintf(stderr, "ERROR: Растр оборвался на строке %u.\n", y);
        status = 1;
        break;
      }

      pack_line(&header, pixels, dither, y, line, linesize);

      if (p2055_page_line(&stream, line, linesize))
      {
        fputs("ERROR: Обрыв записи в принтер.\n", stderr);
        status = 1;
        break;
      }
    }

    if (status || p2055_page_end(&stream, page))
      break;
  }

  if (page > 0)
    p2055_job_end(&stream);
  else if (!status)
  {
    fputs("ERROR: В задании нет ни одной страницы.\n", stderr);
    status = 1;
  }

  if (job_canceled)
    fputs("INFO: Задание отменено.\n", stderr);

  cupsRasterClose(ras);
  p2055_stream_free(&stream);
  cupsFreeOptions(num_options, options);
  free(pixels);
  free(line);

  if (fd)
    close(fd);

  fflush(stdout);

  return (status);
}
