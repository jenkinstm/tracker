/*
 * pcldump — разбирает файл с потоком PCL 5e и печатает отчёт.
 *
 * Позволяет проверить вывод драйвера без принтера: если поток разбирается и
 * счётчики сходятся, принтер получит ровно тот растр, который был отправлен.
 *
 *   ./build/pcldump job.pcl [--pbm out.pbm]
 */

#include "pcl_decode.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>


static unsigned char *
read_file(const char *path, size_t *len)
{
  FILE          *fp = fopen(path, "rb");
  unsigned char *data;
  long           size;

  if (!fp)
    return (NULL);

  if (fseek(fp, 0, SEEK_END) || (size = ftell(fp)) < 0 || fseek(fp, 0, SEEK_SET))
  {
    fclose(fp);
    return (NULL);
  }

  if ((data = malloc((size_t)size + 1)) == NULL)
  {
    fclose(fp);
    return (NULL);
  }

  *len = fread(data, 1, (size_t)size, fp);
  fclose(fp);

  return (data);
}


/* Выгружает восстановленный растр в PBM — его открывает любой просмотрщик. */
static int
write_pbm(const char *path, const pcl_stream_t *stream)
{
  FILE  *fp = fopen(path, "wb");
  size_t y;

  if (!fp)
    return (-1);

  fprintf(fp, "P4\n%u %zu\n", stream->width, stream->num_rows);

  for (y = 0; y < stream->num_rows; y++)
    fwrite(stream->rows[y], 1, stream->linesize, fp);

  fclose(fp);

  return (0);
}


int
main(int argc, char *argv[])
{
  unsigned char *data;
  size_t         len = 0, black = 0, y, i;
  pcl_stream_t   stream;
  const char    *pbm = NULL;

  if (argc < 2)
  {
    fputs("Использование: pcldump файл.pcl [--pbm выход.pbm]\n", stderr);
    return (1);
  }

  if (argc > 3 && !strcmp(argv[2], "--pbm"))
    pbm = argv[3];

  if ((data = read_file(argv[1], &len)) == NULL)
  {
    fprintf(stderr, "pcldump: не удалось прочитать %s\n", argv[1]);
    return (1);
  }

  pcl_parse(data, len, &stream);

  for (y = 0; y < stream.num_rows; y++)
    for (i = 0; i < stream.linesize; i++)
    {
      unsigned char byte = stream.rows[y][i];

      while (byte)
      {
        black += byte & 1;
        byte >>= 1;
      }
    }

  printf("файл:              %s (%zu байт)\n", argv[1], len);
  printf("обвязка PJL:       %s\n", stream.has_pjl_enter ? "есть" : "НЕТ");
  printf("сбросов ESC E:     %d\n", stream.resets);
  printf("разрешение:        %d dpi\n", stream.resolution);
  printf("формат бумаги:     код %d\n", stream.page_size);
  printf("подача:            код %d\n", stream.media_source);
  printf("дуплекс:           %d (оборотов: %d)\n", stream.duplex, stream.backsides);
  printf("копий:             %d\n", stream.copies);
  printf("ширина растра:     %u точек (%zu байт в строке)\n", stream.width, stream.linesize);
  printf("строк растра:      %zu\n", stream.num_rows);
  printf("страниц:           %d (закрытий растра: %d)\n", stream.form_feeds, stream.raster_ends);
  printf("строк по режимам:  0=%zu 2=%zu 3=%zu\n",
         stream.mode_rows[0], stream.mode_rows[2], stream.mode_rows[3]);
  printf("растровых данных:  %zu байт", stream.raster_bytes);

  if (stream.num_rows && stream.linesize)
    printf(" (%.1f%% от несжатого)",
           100.0 * (double)stream.raster_bytes / (double)(stream.num_rows * stream.linesize));

  printf("\n");
  printf("чёрных точек:      %zu\n", black);
  printf("разбор:            %s\n", stream.error ? "ОШИБКА" : "успешно");

  if (pbm && write_pbm(pbm, &stream))
    fprintf(stderr, "pcldump: не удалось записать %s\n", pbm);

  pcl_stream_free(&stream);
  free(data);

  return (stream.error ? 1 : 0);
}
