#include "pcl_decode.h"

#include <stdlib.h>
#include <string.h>


size_t
pcl_decode_tiff(const unsigned char *in, size_t len, unsigned char *out, size_t outmax)
{
  size_t i = 0, o = 0;

  while (i < len)
  {
    int ctrl = in[i++];

    if (ctrl == 128)
      continue;

    if (ctrl < 128)
    {
      size_t count = (size_t)ctrl + 1;

      if (i + count > len || o + count > outmax)
        return ((size_t)-1);

      memcpy(out + o, in + i, count);
      i += count;
      o += count;
    }
    else
    {
      size_t count = 257 - (size_t)ctrl;

      if (i >= len || o + count > outmax)
        return ((size_t)-1);

      memset(out + o, in[i++], count);
      o += count;
    }
  }

  return (o);
}


int
pcl_decode_delta(const unsigned char *in, size_t len, unsigned char *row, size_t rowlen)
{
  size_t i = 0, pos = 0;

  while (i < len)
  {
    size_t run    = (size_t)((in[i] >> 5) & 7) + 1;
    size_t offset = (size_t)(in[i] & 31);

    i++;

    if (offset == 31)
    {
      while (i < len)
      {
        offset += in[i];

        if (in[i++] != 255)
          break;
      }
    }

    pos += offset;

    if (i + run > len || pos + run > rowlen)
      return (-1);

    memcpy(row + pos, in + i, run);
    i   += run;
    pos += run;
  }

  return (0);
}


void
pcl_parse(const unsigned char *data, size_t len, pcl_stream_t *out)
{
  size_t         i    = 0;
  int            mode = 0;
  unsigned char *seed = NULL;
  size_t         seedsize = 0;

  memset(out, 0, sizeof(*out));

  if (len >= 9 && !memcmp(data, "\033%-12345X", 9))
  {
    size_t scan;

    for (scan = 9; scan + 23 < len && scan < 512; scan++)
      if (!memcmp(data + scan, "@PJL ENTER LANGUAGE=PCL", 23))
      {
        out->has_pjl_enter = 1;
        break;
      }
  }

  while (i < len)
  {
    int p, value, term, negative;

    if (data[i] != 033)
    {
      if (data[i] == 014)
        out->form_feeds++;

      i++;
      continue;
    }

    i++;

    if (i >= len)
      break;

    if (data[i] == 'E')
    {
      out->resets++;
      i++;
      continue;
    }

    if (data[i] == '%')
    {
      /* UEL и следующие за ним строки PJL — до ближайшего ESC. */
      i++;

      while (i < len && data[i] != 033)
        i++;

      continue;
    }

    p = data[i++];

    if (i >= len)
      break;

    i++;  /* групповой символ */

    for (;;)
    {
      negative = 0;
      value    = 0;

      if (i < len && (data[i] == '-' || data[i] == '+'))
        negative = data[i++] == '-';

      while (i < len && data[i] >= '0' && data[i] <= '9')
        value = value * 10 + (data[i++] - '0');

      if (i >= len)
      {
        free(seed);
        return;
      }

      term = data[i++];

      if (negative)
        value = -value;

      if (p == '*' && (term == 'W' || term == 'w'))
      {
        unsigned char *row;

        if (i + (size_t)value > len || !out->linesize || value < 0)
        {
          out->error = 1;
          free(seed);
          return;
        }

        if ((row = calloc(1, out->linesize)) == NULL)
        {
          out->error = 1;
          free(seed);
          return;
        }

        if (mode == 3)
        {
          if (seed && seedsize == out->linesize)
            memcpy(row, seed, out->linesize);

          if (pcl_decode_delta(data + i, (size_t)value, row, out->linesize))
            out->error = 1;
        }
        else if (mode == 2)
        {
          if (pcl_decode_tiff(data + i, (size_t)value, row, out->linesize) == (size_t)-1)
            out->error = 1;
        }
        else if (mode == 0)
        {
          if ((size_t)value > out->linesize)
            out->error = 1;
          else
            memcpy(row, data + i, (size_t)value);
        }
        else
          out->error = 1;

        i += (size_t)value;

        out->rows = realloc(out->rows, (out->num_rows + 1) * sizeof(unsigned char *));

        if (!out->rows)
        {
          out->error = 1;
          free(row);
          free(seed);
          return;
        }

        out->rows[out->num_rows++] = row;
        out->raster_bytes += (size_t)value;

        if (mode >= 0 && mode < 4)
          out->mode_rows[mode]++;

        if (seedsize != out->linesize)
        {
          free(seed);
          seed     = malloc(out->linesize);
          seedsize = seed ? out->linesize : 0;
        }

        if (seed)
          memcpy(seed, row, out->linesize);
      }
      else if (p == '*' && (term == 'M' || term == 'm'))
        mode = value;
      else if (p == '*' && (term == 'S' || term == 's'))
      {
        out->width    = (unsigned)value;
        out->linesize = ((size_t)value + 7) / 8;
      }
      else if (p == '*' && (term == 'T' || term == 't') && value > 200)
        out->height = (unsigned)value;
      else if (p == '*' && (term == 'R' || term == 'r'))
        out->resolution = value;
      else if (p == '*' && term == 'C')
        out->raster_ends++;
      else if (p == '&' && (term == 'A' || term == 'a'))
        out->page_size = value;
      else if (p == '&' && (term == 'H' || term == 'h') && value != 0)
        out->media_source = value;
      else if (p == '&' && (term == 'S' || term == 's'))
        out->duplex = value;
      else if (p == '&' && (term == 'X' || term == 'x'))
        out->copies = value;
      else if (p == '&' && term == 'G')
        out->backsides++;

      if (term < 'a' || term > 'z')
        break;  /* прописной терминатор завершает последовательность */
    }
  }

  free(seed);
}


void
pcl_stream_free(pcl_stream_t *stream)
{
  size_t i;

  for (i = 0; i < stream->num_rows; i++)
    free(stream->rows[i]);

  free(stream->rows);
  stream->rows     = NULL;
  stream->num_rows = 0;
}
