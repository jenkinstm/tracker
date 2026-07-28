import { isIsoDate, weightUpsertSchema } from '@tracker/shared';
import type { FastifyInstance } from 'fastify';

import { getSessionUserId } from '../lib/session.js';
import { deleteWeight, getWeightStats, listMeasurements, upsertWeight } from '../lib/weight.js';

export async function weightRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const { from, to } = request.query as { from?: string; to?: string };
    if ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) {
      return reply.code(400).send({ error: 'invalid_date' });
    }

    return reply.send(await listMeasurements(userId, from, to));
  });

  /** Запись веса (FR-4.1): повторная на ту же дату перезаписывает. */
  app.post('/', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = weightUpsertSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    }

    await upsertWeight(userId, parsed.data.date, parsed.data.kg);

    // Отдаём пересчитанные тренд и прогноз: после записи веса они меняются,
    // и второй запрос за ними экрану не нужен.
    return reply.send(await getWeightStats(userId));
  });

  app.delete('/:date', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const { date } = request.params as { date: string };
    if (!isIsoDate(date)) return reply.code(400).send({ error: 'invalid_date' });

    const removed = await deleteWeight(userId, date);
    if (!removed) return reply.code(404).send({ error: 'not_found' });

    return reply.send(await getWeightStats(userId));
  });
}

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  /** Тренд, темп, прогноз (FR-4.2 – FR-4.5). */
  app.get('/trend', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    return reply.send(await getWeightStats(userId));
  });
}
