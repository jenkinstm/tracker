/*
 * Разбор потока PCL 5e обратно в растр. Используется тестами и утилитой
 * pcldump — она позволяет проверить вывод драйвера, не имея принтера.
 */

#ifndef PCL_DECODE_H
#define PCL_DECODE_H

#include <stddef.h>

typedef struct pcl_stream_s
{
  unsigned char **rows;          /* восстановленные строки растра */
  size_t          num_rows;
  size_t          linesize;
  unsigned        width;
  unsigned        height;
  int             page_size;
  int             media_source;
  int             duplex;
  int             copies;
  int             resolution;
  int             form_feeds;
  int             backsides;
  int             resets;
  int             raster_ends;
  int             has_pjl_enter;
  size_t          mode_rows[4];  /* сколько строк передано каждым режимом сжатия */
  size_t          raster_bytes;  /* объём растровых данных без управляющих команд */
  int             error;
} pcl_stream_t;

size_t pcl_decode_tiff(const unsigned char *in, size_t len, unsigned char *out, size_t outmax);
int    pcl_decode_delta(const unsigned char *in, size_t len, unsigned char *row, size_t rowlen);
void   pcl_parse(const unsigned char *data, size_t len, pcl_stream_t *out);
void   pcl_stream_free(pcl_stream_t *stream);

#endif /* !PCL_DECODE_H */
