import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import secureSession from '@fastify/secure-session';
import Fastify, { type FastifyInstance } from 'fastify';

import { env, isProduction } from './env.js';
import { SESSION_TTL_SECONDS } from './lib/session.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { profileRoutes } from './routes/profile.js';

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

  return app;
}
