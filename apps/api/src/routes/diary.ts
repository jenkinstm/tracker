import { diaryCreateSchema, diaryUpdateSchema, isIsoDate } from '@tracker/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';

import {
  type DiaryFailure,
  createDiaryEntry,
  deleteDiaryEntry,
  getDiaryDay,
  updateDiaryEntry,
} from '../lib/diary.js';
import { getRecentFoods } from '../lib/recent.js';
import { getSessionUserId } from '../lib/session.js';

const STATUS_BY_FAILURE: Record<DiaryFailure, number> = {
  food_not_found: 404,
  not_found: 404,
  invalid_grams: 400,
  // Продукт удалён, а запись на него ссылается — пересчитать вес не от чего.
  food_gone: 409,
};

function fail(reply: FastifyReply, error: DiaryFailure) {
  return reply.code(STATUS_BY_FAILURE[error]).send({ error });
}

export async function diaryRoutes(app: FastifyInstance): Promise<void> {
  /** «Недавние» и «частые» (FR-2.6). Объявлено до «/:date», иначе перехватится им. */
  app.get('/recent', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    return reply.send(await getRecentFoods(userId));
  });

  app.get('/:date', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const { date } = request.params as { date: string };
    if (!isIsoDate(date)) return reply.code(400).send({ error: 'invalid_date' });

    return reply.send(await getDiaryDay(userId, date));
  });

  app.post('/', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = diaryCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    }

    const result = await createDiaryEntry(userId, parsed.data);
    if (!result.ok) return fail(reply, result.error);

    return reply.code(201).send(await getDiaryDay(userId, result.value));
  });

  app.patch('/:id', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = diaryUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    }

    const { id } = request.params as { id: string };
    const result = await updateDiaryEntry(userId, id, parsed.data);
    if (!result.ok) return fail(reply, result.error);

    return reply.send(await getDiaryDay(userId, result.value));
  });

  app.delete('/:id', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const { id } = request.params as { id: string };
    const result = await deleteDiaryEntry(userId, id);
    if (!result.ok) return fail(reply, result.error);

    return reply.send(await getDiaryDay(userId, result.value));
  });
}
