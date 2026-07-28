import { isIsoDate, stepsUpdateSchema, waterUpdateSchema } from '@tracker/shared';
import type { FastifyInstance } from 'fastify';

import { getDiaryDay, setWaterGlasses } from '../lib/diary.js';
import { getSessionUserId } from '../lib/session.js';
import { getWorkoutDay, setSteps } from '../lib/workout.js';

/** Вода (FR-2.13) и шаги (FR-5.9) — то, что пишется на день целиком. */
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

  /** Шаги за день — ручной ввод (FR-5.9). */
  app.put('/:date/steps', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const { date } = request.params as { date: string };
    if (!isIsoDate(date)) return reply.code(400).send({ error: 'invalid_date' });

    const parsed = stepsUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    }

    await setSteps(userId, date, parsed.data.steps);

    return reply.send(await getWorkoutDay(userId, date));
  });
}
