import { foodCreateSchema, foodSearchSchema, foodUpdateSchema } from '@tracker/shared';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../db.js';
import { foodToInfo, getAccessibleFood, searchFoods } from '../lib/foodSearch.js';
import { getSessionUserId } from '../lib/session.js';

export async function foodRoutes(app: FastifyInstance): Promise<void> {
  /** Поиск по локальной базе (FR-2.1). */
  app.get('/', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = foodSearchSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', details: parsed.error.issues });
    }

    return reply.send(await searchFoods(userId, parsed.data.q, parsed.data.limit));
  });

  app.get('/:id', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const { id } = request.params as { id: string };
    const food = await getAccessibleFood(userId, id);
    if (!food) return reply.code(404).send({ error: 'not_found' });

    return reply.send(foodToInfo(food));
  });

  /** Свой продукт (FR-2.5): участвует в поиске наравне с сидом. */
  app.post('/', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = foodCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    }

    const food = await prisma.food.create({
      data: { ...parsed.data, userId, source: 'OWN' },
      include: { units: true },
    });

    return reply.code(201).send(foodToInfo(food));
  });

  app.patch('/:id', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = foodUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    }

    // Сидовые продукты общие: правка одним пользователем меняла бы их всем.
    const own = await prisma.food.findFirst({ where: { id: (request.params as { id: string }).id, userId } });
    if (!own) return reply.code(404).send({ error: 'not_found' });

    const food = await prisma.food.update({
      where: { id: own.id },
      data: parsed.data,
      include: { units: true },
    });

    return reply.send(foodToInfo(food));
  });

  app.delete('/:id', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const own = await prisma.food.findFirst({ where: { id: (request.params as { id: string }).id, userId } });
    if (!own) return reply.code(404).send({ error: 'not_found' });

    // Записи дневника переживут удаление: КБЖУ и название лежат в них снимком,
    // а внешний ключ обнулится по onDelete: SetNull.
    await prisma.food.delete({ where: { id: own.id } });

    return reply.code(204).send();
  });
}
