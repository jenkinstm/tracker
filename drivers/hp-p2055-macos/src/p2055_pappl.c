/*
 * Printer application для HP LaserJet P2055 на базе PAPPL.
 *
 * Поднимает локальный сервис IPP Everywhere/AirPrint, который macOS видит как
 * «драйверless»-принтер, и превращает приходящий PWG-растр в PCL 5e.
 * Это единственный способ подключить P2055 к macOS 26, где классические
 * драйверы с PPD больше не поддерживаются.
 *
 * Сборка: make app   (нужны PAPPL 1.2+ и libcups)
 */

#include <pappl/pappl.h>

#include <errno.h>
#include <fcntl.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "p2055_pcl.h"

#define P2055_APP_VERSION "1.0.0"
#define P2055_DRIVER_NAME "hp_laserjet_p2055"

#if CUPS_VERSION_MAJOR < 3
#  define cups_page_header_t cups_page_header2_t
#endif


typedef struct p2055_map_s
{
  const char *keyword;
  int         value;
} p2055_map_t;

typedef struct p2055_job_s
{
  p2055_stream_t stream;
  p2055_page_t   page;
  unsigned char *line;      /* однобитная строка для принтера */
  size_t         linesize;
  unsigned       xstart, xend, ystart, yend;
  int            failed;
} p2055_job_t;


static pappl_pr_driver_t p2055_drivers[] =
{
  {
    P2055_DRIVER_NAME,
    "HP LaserJet P2055 (PCL 5e)",
    "MFG:Hewlett-Packard;MDL:HP LaserJet P2055;CMD:PJL,PCL,PCLXL,POSTSCRIPT;",
    NULL
  }
};

static const char * const p2055_media[] =
{
  "iso_a4_210x297mm",
  "iso_a5_148x210mm",
  "na_letter_8.5x11in",
  "na_legal_8.5x14in",
  "na_executive_7x10in",
  "jis_b5_182x257mm",
  "iso_b5_176x250mm",
  "na_number-10_4.125x9.5in",
  "iso_c5_162x229mm",
  "iso_dl_110x220mm",
  "na_monarch_3.875x7.5in"
};

static const p2055_map_t p2055_sizes[] =
{
  { "iso_a4_210x297mm",          P2055_SIZE_A4 },
  { "iso_a5_148x210mm",          P2055_SIZE_A5 },
  { "na_letter_8.5x11in",        P2055_SIZE_LETTER },
  { "na_legal_8.5x14in",         P2055_SIZE_LEGAL },
  { "na_executive_7x10in",       P2055_SIZE_EXECUTIVE },
  { "jis_b5_182x257mm",          P2055_SIZE_JIS_B5 },
  { "iso_b5_176x250mm",          P2055_SIZE_ISO_B5 },
  { "na_number-10_4.125x9.5in",  P2055_SIZE_COM10 },
  { "iso_c5_162x229mm",          P2055_SIZE_C5 },
  { "iso_dl_110x220mm",          P2055_SIZE_DL },
  { "na_monarch_3.875x7.5in",    P2055_SIZE_MONARCH }
};

static const p2055_map_t p2055_sources[] =
{
  { "default",      P2055_SOURCE_AUTO },
  { "auto",         P2055_SOURCE_AUTO },
  { "by-pass-tray", P2055_SOURCE_TRAY1 },
  { "tray-1",       P2055_SOURCE_TRAY1 },
  { "main",         P2055_SOURCE_TRAY2 },
  { "tray-2",       P2055_SOURCE_TRAY2 },
  { "tray-3",       P2055_SOURCE_TRAY3 },
  { "manual",       P2055_SOURCE_MANUAL }
};

static const p2055_map_t p2055_types[] =
{
  { "stationery",             P2055_TYPE_PLAIN },
  { "stationery-letterhead",  P2055_TYPE_BOND },
  { "cardstock",              P2055_TYPE_SPECIAL },
  { "labels",                 P2055_TYPE_SPECIAL },
  { "envelope",               P2055_TYPE_SPECIAL },
  { "transparency",           P2055_TYPE_TRANSPARENCY }
};


static const char *p2055_autoadd(const char *device_info, const char *device_uri,
                                 const char *device_id, void *data);
static bool p2055_callback(pappl_system_t *system, const char *driver_name,
                           const char *device_uri, const char *device_id,
                           pappl_pr_driver_data_t *driver_data, ipp_t **driver_attrs,
                           void *data);
static bool p2055_print_raw(pappl_job_t *job, pappl_pr_options_t *options, pappl_device_t *device);
static bool p2055_rendjob(pappl_job_t *job, pappl_pr_options_t *options, pappl_device_t *device);
static bool p2055_rendpage(pappl_job_t *job, pappl_pr_options_t *options, pappl_device_t *device,
                           unsigned page);
static bool p2055_rstartjob(pappl_job_t *job, pappl_pr_options_t *options, pappl_device_t *device);
static bool p2055_rstartpage(pappl_job_t *job, pappl_pr_options_t *options, pappl_device_t *device,
                             unsigned page);
static bool p2055_rwriteline(pappl_job_t *job, pappl_pr_options_t *options, pappl_device_t *device,
                             unsigned y, const unsigned char *pixels);
static bool p2055_status(pappl_printer_t *printer);


static int
p2055_lookup(const p2055_map_t *map, size_t count, const char *keyword, int fallback)
{
  size_t i;

  if (keyword)
    for (i = 0; i < count; i++)
      if (!strcmp(keyword, map[i].keyword))
        return (map[i].value);

  return (fallback);
}


static int
p2055_device_write(void *ctx, const void *buf, size_t bytes)
{
  return (papplDeviceWrite((pappl_device_t *)ctx, buf, bytes) == (ssize_t)bytes ? 0 : -1);
}


int
main(int argc, char *argv[])
{
  return (papplMainloop(argc, argv,
                        P2055_APP_VERSION,
                        "Драйвер HP LaserJet P2055 для macOS. Apache License 2.0.",
                        (int)(sizeof(p2055_drivers) / sizeof(p2055_drivers[0])),
                        p2055_drivers, p2055_autoadd, p2055_callback,
                        /*subcmd_name*/NULL, /*subcmd_cb*/NULL,
                        /*system_cb*/NULL,
                        /*usage_cb*/NULL,
                        /*data*/NULL));
}


static const char *
p2055_autoadd(const char *device_info, const char *device_uri, const char *device_id, void *data)
{
  const char    *ret = NULL, *cmd, *mdl;
  int            num_did;
  cups_option_t *did;

  (void)device_info;
  (void)device_uri;
  (void)data;

  num_did = papplDeviceParseID(device_id, &did);

  if ((cmd = cupsGetOption("COMMAND SET", num_did, did)) == NULL)
    cmd = cupsGetOption("CMD", num_did, did);

  if ((mdl = cupsGetOption("MODEL", num_did, did)) == NULL)
    mdl = cupsGetOption("MDL", num_did, did);

  /* Вся серия P2050 (P2035/P2050/P2055) говорит на одном диалекте PCL 5e. */
  if (cmd && strstr(cmd, "PCL") && mdl &&
      (strstr(mdl, "P2055") || strstr(mdl, "P2050") || strstr(mdl, "P2035")))
    ret = P2055_DRIVER_NAME;

  cupsFreeOptions(num_did, did);

  return (ret);
}


static bool
p2055_callback(pappl_system_t *system, const char *driver_name, const char *device_uri,
               const char *device_id, pappl_pr_driver_data_t *driver_data,
               ipp_t **driver_attrs, void *data)
{
  int i;

  (void)device_uri;
  (void)device_id;
  (void)driver_attrs;
  (void)data;

  if (strcmp(driver_name, P2055_DRIVER_NAME))
  {
    papplLog(system, PAPPL_LOGLEVEL_ERROR, "Неизвестный драйвер '%s'.", driver_name);
    return (false);
  }

  p2055_dither_matrix(driver_data->gdither, 0.4545);
  memcpy(driver_data->pdither, driver_data->gdither, sizeof(driver_data->pdither));

  driver_data->rendjob_cb    = p2055_rendjob;
  driver_data->rendpage_cb   = p2055_rendpage;
  driver_data->rstartjob_cb  = p2055_rstartjob;
  driver_data->rstartpage_cb = p2055_rstartpage;
  driver_data->rwriteline_cb = p2055_rwriteline;
  driver_data->printfile_cb  = p2055_print_raw;
  driver_data->status_cb     = p2055_status;
  driver_data->has_supplies  = true;
  driver_data->format        = "application/vnd.hp-pcl";

  papplCopyString(driver_data->make_and_model, "HP LaserJet P2055",
                  sizeof(driver_data->make_and_model));

  driver_data->orient_default  = IPP_ORIENT_NONE;
  driver_data->quality_default = IPP_QUALITY_NORMAL;
  driver_data->ppm             = 33;

  driver_data->num_resolution  = 2;
  driver_data->x_resolution[0] = 600;
  driver_data->y_resolution[0] = 600;
  driver_data->x_resolution[1] = 1200;
  driver_data->y_resolution[1] = 1200;
  driver_data->x_default = driver_data->y_default = 600;

  driver_data->raster_types = PAPPL_PWG_RASTER_TYPE_BLACK_1 | PAPPL_PWG_RASTER_TYPE_BLACK_8 |
                              PAPPL_PWG_RASTER_TYPE_SGRAY_8;

  driver_data->color_supported = PAPPL_COLOR_MODE_MONOCHROME;
  driver_data->color_default   = PAPPL_COLOR_MODE_MONOCHROME;

  driver_data->num_media = (int)(sizeof(p2055_media) / sizeof(p2055_media[0]));
  memcpy(driver_data->media, p2055_media, sizeof(p2055_media));

  /* Непечатаемые поля P2055: 4 мм по периметру. */
  driver_data->left_right = 400;
  driver_data->bottom_top = 400;

  driver_data->sides_supported = PAPPL_SIDES_ONE_SIDED | PAPPL_SIDES_TWO_SIDED_LONG_EDGE |
                                 PAPPL_SIDES_TWO_SIDED_SHORT_EDGE;
  driver_data->sides_default   = PAPPL_SIDES_ONE_SIDED;

  driver_data->num_source = 4;
  driver_data->source[0]  = "default";
  driver_data->source[1]  = "tray-1";
  driver_data->source[2]  = "tray-2";
  driver_data->source[3]  = "manual";

  driver_data->num_type = 5;
  driver_data->type[0]  = "stationery";
  driver_data->type[1]  = "stationery-letterhead";
  driver_data->type[2]  = "cardstock";
  driver_data->type[3]  = "labels";
  driver_data->type[4]  = "transparency";

  for (i = 0; i < driver_data->num_source; i++)
  {
    pwg_media_t *pwg;

    papplCopyString(driver_data->media_ready[i].size_name, "iso_a4_210x297mm",
                    sizeof(driver_data->media_ready[i].size_name));

    if ((pwg = pwgMediaForPWG(driver_data->media_ready[i].size_name)) != NULL)
    {
      driver_data->media_ready[i].bottom_margin = driver_data->bottom_top;
      driver_data->media_ready[i].top_margin    = driver_data->bottom_top;
      driver_data->media_ready[i].left_margin   = driver_data->left_right;
      driver_data->media_ready[i].right_margin  = driver_data->left_right;
      driver_data->media_ready[i].size_width    = pwg->width;
      driver_data->media_ready[i].size_length   = pwg->length;

      papplCopyString(driver_data->media_ready[i].source, driver_data->source[i],
                      sizeof(driver_data->media_ready[i].source));
      papplCopyString(driver_data->media_ready[i].type, driver_data->type[0],
                      sizeof(driver_data->media_ready[i].type));
    }
  }

  driver_data->media_default = driver_data->media_ready[0];

  return (true);
}


/*
 * Готовый PCL (например, вывод rastertop2055) уходит на принтер как есть.
 * Без этого колбэка PAPPL 1.4 бракует драйвер: объявленный format обязывает
 * уметь печатать файлы этого типа напрямую.
 */

static bool
p2055_print_raw(pappl_job_t *job, pappl_pr_options_t *options, pappl_device_t *device)
{
  int     fd;
  ssize_t bytes;
  char    buffer[65536];

  (void)options;

  papplJobSetImpressions(job, 1);

  if ((fd = open(papplJobGetFilename(job), O_RDONLY)) < 0)
  {
    papplLogJob(job, PAPPL_LOGLEVEL_ERROR, "Не удалось открыть файл задания: %s", strerror(errno));
    return (false);
  }

  while ((bytes = read(fd, buffer, sizeof(buffer))) > 0)
  {
    if (papplDeviceWrite(device, buffer, (size_t)bytes) < 0)
    {
      papplLogJob(job, PAPPL_LOGLEVEL_ERROR, "Обрыв записи в принтер.");
      close(fd);
      return (false);
    }
  }

  close(fd);
  papplDeviceFlush(device);

  if (bytes < 0)
  {
    papplLogJob(job, PAPPL_LOGLEVEL_ERROR, "Не удалось дочитать файл задания.");
    return (false);
  }

  papplJobSetImpressionsCompleted(job, 1);

  return (true);
}


static bool
p2055_rstartjob(pappl_job_t *job, pappl_pr_options_t *options, pappl_device_t *device)
{
  p2055_job_t   *data = (p2055_job_t *)calloc(1, sizeof(p2055_job_t));
  p2055_device_t dev;

  if (!data)
  {
    papplLogJob(job, PAPPL_LOGLEVEL_ERROR, "Не хватило памяти под задание.");
    return (false);
  }

  dev.write = p2055_device_write;
  dev.ctx   = device;

  p2055_stream_init(&data->stream, &dev);
  papplJobSetData(job, data);

  if (p2055_job_begin(&data->stream, papplJobGetName(job), papplJobGetUsername(job),
                      options->printer_resolution[0],
                      options->print_quality == IPP_QUALITY_DRAFT))
  {
    papplLogJob(job, PAPPL_LOGLEVEL_ERROR, "Не удалось начать задание PCL.");
    return (false);
  }

  return (true);
}


static bool
p2055_rstartpage(pappl_job_t *job, pappl_pr_options_t *options, pappl_device_t *device,
                 unsigned page)
{
  p2055_job_t *data = (p2055_job_t *)papplJobGetData(job);

  (void)device;

  if (!data)
    return (false);

  data->xstart = options->printer_resolution[0] * (unsigned)options->media.left_margin / 2540;
  data->xend   = data->xstart + options->printer_resolution[0] *
                     (unsigned)(options->media.size_width - options->media.left_margin -
                                options->media.right_margin) / 2540;
  data->ystart = options->printer_resolution[1] * (unsigned)options->media.top_margin / 2540;
  data->yend   = data->ystart + options->printer_resolution[1] *
                     (unsigned)(options->media.size_length - options->media.top_margin -
                                options->media.bottom_margin) / 2540;

  memset(&data->page, 0, sizeof(data->page));
  data->page.width         = data->xend - data->xstart;
  data->page.height        = data->yend - data->ystart;
  data->page.resolution    = options->printer_resolution[0];
  data->page.copies        = 1;   /* копии размножает PAPPL, чтобы работал разбор по копиям */
  data->page.top_margin_dp = 720u * (unsigned)options->media.top_margin / 2540u;
  data->page.economode     = options->print_quality == IPP_QUALITY_DRAFT;
  data->page.page_size     = p2055_lookup(p2055_sizes,
                                          sizeof(p2055_sizes) / sizeof(p2055_sizes[0]),
                                          options->media.size_name, P2055_SIZE_A4);
  data->page.media_source  = p2055_lookup(p2055_sources,
                                          sizeof(p2055_sources) / sizeof(p2055_sources[0]),
                                          options->media.source, P2055_SOURCE_AUTO);
  data->page.media_type    = p2055_lookup(p2055_types,
                                          sizeof(p2055_types) / sizeof(p2055_types[0]),
                                          options->media.type, P2055_TYPE_PLAIN);

  switch (options->sides)
  {
    case PAPPL_SIDES_TWO_SIDED_LONG_EDGE :
        data->page.duplex = P2055_DUPLEX_LONG_EDGE;
        break;
    case PAPPL_SIDES_TWO_SIDED_SHORT_EDGE :
        data->page.duplex = P2055_DUPLEX_SHORT_EDGE;
        break;
    default :
        data->page.duplex = P2055_DUPLEX_OFF;
        break;
  }

  data->linesize = (data->page.width + 7) / 8;
  data->failed   = 0;

  free(data->line);

  if ((data->line = calloc(1, data->linesize)) == NULL)
  {
    papplLogJob(job, PAPPL_LOGLEVEL_ERROR, "Не хватило памяти под строку растра.");
    return (false);
  }

  if (p2055_page_begin(&data->stream, &data->page, page))
  {
    papplLogJob(job, PAPPL_LOGLEVEL_ERROR, "Не удалось начать страницу %u.", page);
    return (false);
  }

  return (true);
}


static bool
p2055_rwriteline(pappl_job_t *job, pappl_pr_options_t *options, pappl_device_t *device,
                 unsigned y, const unsigned char *pixels)
{
  p2055_job_t        *data   = (p2055_job_t *)papplJobGetData(job);
  cups_page_header_t *header = &(options->header);
  unsigned            x;
  unsigned char      *out;
  unsigned char       bit;

  (void)device;

  if (!data || data->failed)
    return (data && !data->failed);

  if (y < data->ystart || y >= data->yend)
    return (true);

  out = data->line;
  memset(out, 0, data->linesize);

  if (header->cupsBitsPerPixel == 1)
  {
    /* Готовый однобитный растр: сдвигаем окно печати к границе байта. */
    unsigned shift = data->xstart % 8;
    size_t   first = data->xstart / 8;
    size_t   i;

    for (i = 0; i < data->linesize; i++)
    {
      unsigned char hi = (first + i) < header->cupsBytesPerLine ? pixels[first + i] : 0;
      unsigned char lo = (first + i + 1) < header->cupsBytesPerLine ? pixels[first + i + 1] : 0;

      out[i] = shift ? (unsigned char)((hi << shift) | (lo >> (8 - shift))) : hi;
    }

    if (header->cupsColorSpace != CUPS_CSPACE_K)
      for (i = 0; i < data->linesize; i++)
        out[i] = (unsigned char)~out[i];
  }
  else
  {
    /* 8 бит на точку: пороговая матрица переводит полутона в точки. */
    const unsigned char *dither = options->dither[y & 15];
    const unsigned char *pixptr = pixels + data->xstart;
    int                  black  = header->cupsColorSpace == CUPS_CSPACE_K;

    for (x = data->xstart, bit = 128; x < data->xend; x++, pixptr++)
    {
      unsigned value = black ? *pixptr : 255u - *pixptr;

      if (value >= dither[x & 15])
        out[(x - data->xstart) / 8] |= bit;

      bit = bit > 1 ? bit / 2 : 128;
    }
  }

  if (p2055_page_line(&data->stream, out, data->linesize))
  {
    papplLogJob(job, PAPPL_LOGLEVEL_ERROR, "Обрыв записи в принтер на строке %u.", y);
    data->failed = 1;
    return (false);
  }

  return (true);
}


static bool
p2055_rendpage(pappl_job_t *job, pappl_pr_options_t *options, pappl_device_t *device, unsigned page)
{
  p2055_job_t *data = (p2055_job_t *)papplJobGetData(job);

  (void)options;

  if (!data)
    return (false);

  if (p2055_page_end(&data->stream, page))
    return (false);

  papplDeviceFlush(device);

  return (true);
}


static bool
p2055_rendjob(pappl_job_t *job, pappl_pr_options_t *options, pappl_device_t *device)
{
  p2055_job_t *data = (p2055_job_t *)papplJobGetData(job);
  bool         ok;

  (void)options;

  if (!data)
    return (false);

  ok = p2055_job_end(&data->stream) == 0;

  papplDeviceFlush(device);

  p2055_stream_free(&data->stream);
  free(data->line);
  free(data);
  papplJobSetData(job, NULL);

  p2055_status(papplJobGetPrinter(job));

  return (ok);
}


static bool
p2055_status(pappl_printer_t *printer)
{
  pappl_device_t *device;
  pappl_supply_t  supply[32];
  int             num_supply;

  if (papplPrinterGetSupplies(printer, 0, supply) > 0)
    return (true);

  if ((device = papplPrinterOpenDevice(printer)) != NULL)
  {
    num_supply = papplDeviceGetSupplies(device, (int)(sizeof(supply) / sizeof(supply[0])), supply);

    if (num_supply > 0)
      papplPrinterSetSupplies(printer, num_supply, supply);

    papplPrinterSetReasons(printer, papplDeviceGetStatus(device), PAPPL_PREASON_DEVICE_STATUS);
    papplPrinterCloseDevice(printer);

    if (num_supply > 0)
      return (true);
  }

  /* Без SNMP уровень тонера неизвестен — показываем один картридж со 100 %,
     иначе клиенты рисуют пустой расходник. */
  supply[0].color    = PAPPL_SUPPLY_COLOR_BLACK;
  supply[0].is_consumed = true;
  supply[0].level    = 100;
  supply[0].type     = PAPPL_SUPPLY_TYPE_TONER;
  papplCopyString(supply[0].description, "Тонер (CE505A)", sizeof(supply[0].description));

  papplPrinterSetSupplies(printer, 1, supply);

  return (true);
}
