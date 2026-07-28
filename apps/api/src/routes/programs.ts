import { programCreateSchema, programUpdateSchema } from '@tracker/shared';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../db.js';
import { getSessionUserId } from '../lib/session.js';
import { listPrograms, toProgramInfo } from '../lib/workout.js';

const include = {
  items: { include: { exercise: true }, orderBy: { order: 'asc' } },
} as const;

/** Программы: именованные комплексы с целевыми подходами и повторами (FR-5.2). */
export async function programRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    return reply.send(await listPrograms(userId));
  });

  app.post('/', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = programCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    }

    if (!(await exercisesExist(userId, parsed.data.items.map((item) => item.exerciseId)))) {
      return reply.code(400).send({ error: 'unknown_exercise' });
    }

    const program = await prisma.program.create({
      data: {
        userId,
        name: parsed.data.name,
        items: {
          create: parsed.data.items.map((item, index) => ({
            exerciseId: item.exerciseId,
            order: index + 1,
            targetSets: item.targetSets,
            targetReps: item.targetReps,
          })),
        },
      },
      include,
    });

    return reply.code(201).send(toProgramInfo(program));
  });

  app.patch('/:id', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = programUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    }

    const { id } = request.params as { id: string };
    const existing = await prisma.program.findFirst({ where: { id, userId } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });

    const items = parsed.data.items;

    if (items && !(await exercisesExist(userId, items.map((item) => item.exerciseId)))) {
      return reply.code(400).send({ error: 'unknown_exercise' });
    }

    const program = await prisma.$transaction(async (tx) => {
      if (parsed.data.name !== undefined) {
        await tx.program.update({ where: { id: existing.id }, data: { name: parsed.data.name } });
      }

      // Состав переписывается целиком: сверять порядок построчно сложнее,
      // чем пересоздать, а ссылок на program_items ниоткуда нет.
      if (items) {
        await tx.programItem.deleteMany({ where: { programId: existing.id } });
        await tx.programItem.createMany({
          data: items.map((item, index) => ({
            programId: existing.id,
            exerciseId: item.exerciseId,
            order: index + 1,
            targetSets: item.targetSets,
            targetReps: item.targetReps,
          })),
        });
      }

      return tx.program.findUniqueOrThrow({ where: { id: existing.id }, include });
    });

    return reply.send(toProgramInfo(program));
  });

  app.delete('/:id', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const { id } = request.params as { id: string };
    const existing = await prisma.program.findFirst({ where: { id, userId } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });

    // Проведённые тренировки остаются: program_id обнулится по SetNull,
    // подходы и веса никуда не денутся.
    await prisma.program.delete({ where: { id: existing.id } });

    return reply.code(204).send();
  });
}

async function exercisesExist(userId: string, ids: string[]): Promise<boolean> {
  if (ids.length === 0) return true;

  const found = await prisma.exercise.count({
    where: { id: { in: ids }, OR: [{ userId: null }, { userId }] },
  });

  return found === new Set(ids).size;
}
