import { exerciseCreateSchema, exerciseUpdateSchema } from '@tracker/shared';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../db.js';
import { getSessionUserId } from '../lib/session.js';
import { toExerciseInfo } from '../lib/workout.js';

/** Библиотека упражнений (FR-5.1): сид плюс свои. */
export async function exerciseRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const exercises = await prisma.exercise.findMany({
      where: { OR: [{ userId: null }, { userId }] },
      // Свои выше сидовых: заведены руками, значит нужны чаще.
      orderBy: [{ userId: 'desc' }, { name: 'asc' }],
    });

    return reply.send(exercises.map(toExerciseInfo));
  });

  app.post('/', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = exerciseCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    }

    const exercise = await prisma.exercise.create({ data: { ...parsed.data, userId } });

    return reply.code(201).send(toExerciseInfo(exercise));
  });

  app.patch('/:id', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = exerciseUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    }

    // Сидовые упражнения общие — правка меняла бы их для всех программ.
    const { id } = request.params as { id: string };
    const own = await prisma.exercise.findFirst({ where: { id, userId } });
    if (!own) return reply.code(404).send({ error: 'not_found' });

    const exercise = await prisma.exercise.update({ where: { id: own.id }, data: parsed.data });

    return reply.send(toExerciseInfo(exercise));
  });

  app.delete('/:id', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const { id } = request.params as { id: string };
    const own = await prisma.exercise.findFirst({ where: { id, userId } });
    if (!own) return reply.code(404).send({ error: 'not_found' });

    // Упражнение из программы или истории удалять нельзя: в схеме на этих
    // связях onDelete: Restrict, и историю тренировок нужно сохранить.
    const [inProgram, inSets] = await Promise.all([
      prisma.programItem.count({ where: { exerciseId: own.id } }),
      prisma.workoutSet.count({ where: { exerciseId: own.id } }),
    ]);

    if (inProgram > 0 || inSets > 0) {
      return reply.code(409).send({ error: 'exercise_in_use', inProgram, inSets });
    }

    await prisma.exercise.delete({ where: { id: own.id } });

    return reply.code(204).send();
  });
}
