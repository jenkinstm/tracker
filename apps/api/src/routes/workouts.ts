import {
  isIsoDate,
  setCreateSchema,
  setUpdateSchema,
  workoutCreateSchema,
  workoutUpdateSchema,
} from '@tracker/shared';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../db.js';
import { getSessionUserId } from '../lib/session.js';
import {
  addSet,
  findWorkoutIdBySet,
  getWorkoutDate,
  getWorkoutDay,
  startWorkout,
} from '../lib/workout.js';

export async function workoutRoutes(app: FastifyInstance): Promise<void> {
  app.get('/:date', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const { date } = request.params as { date: string };
    if (!isIsoDate(date)) return reply.code(400).send({ error: 'invalid_date' });

    return reply.send(await getWorkoutDay(userId, date));
  });

  /** Старт тренировки: подходы создаются предзаполненными (FR-5.4). */
  app.post('/', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = workoutCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    }

    const result = await startWorkout(userId, parsed.data.date, parsed.data.programId);
    if (!result.ok) return reply.code(404).send({ error: result.error });

    return reply.code(201).send(await getWorkoutDay(userId, parsed.data.date));
  });

  app.patch('/:id', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = workoutUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    }

    const { id } = request.params as { id: string };
    const date = await getWorkoutDate(userId, id);
    if (!date) return reply.code(404).send({ error: 'not_found' });

    await prisma.workout.update({ where: { id }, data: parsed.data });

    return reply.send(await getWorkoutDay(userId, date));
  });

  app.delete('/:id', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const { id } = request.params as { id: string };
    const date = await getWorkoutDate(userId, id);
    if (!date) return reply.code(404).send({ error: 'not_found' });

    // Подходы уйдут каскадом — так задано в схеме.
    await prisma.workout.delete({ where: { id } });

    return reply.send(await getWorkoutDay(userId, date));
  });

  /** «+ подход» (FR-5.4). */
  app.post('/:id/sets', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = setCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    }

    const { id } = request.params as { id: string };
    const date = await getWorkoutDate(userId, id);
    if (!date) return reply.code(404).send({ error: 'not_found' });

    const result = await addSet(userId, id, parsed.data.exerciseId, parsed.data);
    if (!result.ok) return reply.code(404).send({ error: result.error });

    return reply.code(201).send(await getWorkoutDay(userId, date));
  });
}

/** Подходы живут отдельным префиксом — так они описаны в разделе 6 ТЗ. */
export async function setRoutes(app: FastifyInstance): Promise<void> {
  app.patch('/:id', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = setUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    }

    const { id } = request.params as { id: string };
    const workoutId = await findWorkoutIdBySet(userId, id);
    if (!workoutId) return reply.code(404).send({ error: 'not_found' });

    await prisma.workoutSet.update({ where: { id }, data: parsed.data });

    const date = await getWorkoutDate(userId, workoutId);
    return reply.send(await getWorkoutDay(userId, date!));
  });

  app.delete('/:id', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const { id } = request.params as { id: string };
    const workoutId = await findWorkoutIdBySet(userId, id);
    if (!workoutId) return reply.code(404).send({ error: 'not_found' });

    await prisma.workoutSet.delete({ where: { id } });

    const date = await getWorkoutDate(userId, workoutId);
    return reply.send(await getWorkoutDay(userId, date!));
  });
}
