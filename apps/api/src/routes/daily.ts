import { isIsoDate, waterUpdateSchema } from '@tracker/shared';
import type { FastifyInstance } from 'fastify';

import { getDiaryDay, setWaterGlasses } from '../lib/diary.js';
import { getSessionUserId } from '../lib/session.js';

/** Вода: счётчик стаканов с дневной целью (FR-2.13). */
export async function dailyRoutes(app: FastifyInstance): Promise<void> {
  app.put('/:date/water', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const { date } = request.params as { date: string };
    if (!isIsoDate(date)) return reply.code(400).send({ error: 'invalid_date' });

    const parsed = waterUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    }

    await setWaterGlasses(userId, date, parsed.data.glasses);

    return reply.send(await getDiaryDay(userId, date));
  });
}
