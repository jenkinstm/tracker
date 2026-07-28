import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import secureSession from '@fastify/secure-session';
import Fastify, { type FastifyInstance } from 'fastify';

import { env, isProduction } from './env.js';
import { SESSION_TTL_SECONDS } from './lib/session.js';
import { authRoutes } from './routes/auth.js';
import { dailyRoutes } from './routes/daily.js';
import { diaryRoutes } from './routes/diary.js';
import { foodRoutes } from './routes/foods.js';
import { healthRoutes } from './routes/health.js';
import { profileRoutes } from './routes/profile.js';
import { exerciseRoutes } from './routes/exercises.js';
import { programRoutes } from './routes/programs.js';
import { statsRoutes, weightRoutes } from './routes/weights.js';
import { setRoutes, workoutRoutes } from './routes/workouts.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: isProduction ? 'info' : 'debug' },
    // За Caddy включается через TRUST_PROXY. В деве выключено: иначе любой
    // клиент подделает X-Forwarded-For и обойдёт лимит попыток входа.
    trustProxy: env.TRUST_PROXY,
  });

  await app.register(helmet, {
    contentSecurityPolicy: isProduction,
  });

  await app.register(rateLimit, { global: false });

  await app.register(secureSession, {
    key: Buffer.from(env.SESSION_SECRET, 'base64'),
    cookieName: 'tracker_session',
    expiry: SESSION_TTL_SECONDS,
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: env.COOKIE_SECURE,
      maxAge: SESSION_TTL_SECONDS,
    },
  });

  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(profileRoutes, { prefix: '/api/profile' });
  await app.register(foodRoutes, { prefix: '/api/foods' });
  await app.register(diaryRoutes, { prefix: '/api/diary' });
  await app.register(dailyRoutes, { prefix: '/api/daily' });
  await app.register(weightRoutes, { prefix: '/api/weights' });
  await app.register(statsRoutes, { prefix: '/api/stats' });
  await app.register(exerciseRoutes, { prefix: '/api/exercises' });
  await app.register(programRoutes, { prefix: '/api/programs' });
  await app.register(workoutRoutes, { prefix: '/api/workouts' });
  await app.register(setRoutes, { prefix: '/api/sets' });

  return app;
}
