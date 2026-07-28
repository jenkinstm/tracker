import { verify } from '@node-rs/argon2';
import { loginSchema } from '@tracker/shared';
import type { FastifyInstance } from 'fastify';

import { env } from '../env.js';
import { getSessionUserId } from '../lib/session.js';
import { getSingleUser } from '../lib/user.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/login',
    {
      // FR-1.0: 5 попыток за 15 минут по IP.
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body' });
      }

      const ok = await verify(env.AUTH_PASSWORD_HASH, parsed.data.password).catch(() => false);
      if (!ok) {
        request.log.warn({ ip: request.ip }, 'неудачная попытка входа');
        return reply.code(401).send({ error: 'invalid_password' });
      }

      const user = await getSingleUser();
      request.session.set('userId', user.id);

      return reply.send({ userId: user.id });
    },
  );

  app.post('/logout', async (request, reply) => {
    request.session.delete();
    return reply.send({ ok: true });
  });

  app.get('/me', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    return reply.send({ userId });
  });
}
