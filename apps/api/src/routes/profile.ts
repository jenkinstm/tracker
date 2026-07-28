import { profileUpdateSchema } from '@tracker/shared';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../db.js';
import { getProfileResponse } from '../lib/profile.js';
import { getSessionUserId } from '../lib/session.js';

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    return reply.send(await getProfileResponse(userId));
  });

  app.put('/', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = profileUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    }

    // Схема частичная: пришедшие поля обновляем, остальные не трогаем.
    // Явный null — это «считай по формуле» (FR-1.3), а не «поле не пришло»,
    // поэтому фильтруем только undefined.
    const data = Object.fromEntries(
      Object.entries(parsed.data).filter(([, value]) => value !== undefined),
    );

    await prisma.profile.update({ where: { userId }, data });

    return reply.send(await getProfileResponse(userId));
  });
}
