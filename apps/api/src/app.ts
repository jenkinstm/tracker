import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import secureSession from '@fastify/secure-session';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';

import { env, isProduction } from './env.js';
import { SESSION_TTL_SECONDS } from './lib/session.js';
import { authRoutes } from './routes/auth.js';
import { backupRoutes } from './routes/backup.js';
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
  await app.register(backupRoutes, { prefix: '/api' });

  await registerWebApp(app);

  return app;
}

/**
 * Собранный фронт отдаётся этим же процессом.
 *
 * Альтернатива — отдавать статику из Caddy — требовала бы гонять `dist`
 * между контейнерами через общий том: Caddy не видит содержимое образа
 * приложения. Один процесс на оба — меньше движущихся частей, и версии
 * фронта с бэком не разъезжаются по определению. TLS, сжатие и заголовки
 * остаются на Caddy.
 */
async function registerWebApp(app: FastifyInstance): Promise<void> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../web');

  // В деве фронт живёт на vite, каталога сборки нет — и это нормально.
  if (!existsSync(join(root, 'index.html'))) {
    app.log.info('собранный фронт не найден, отдаётся только API');
    return;
  }

  // index обязателен: без него запрос «/» упирается в 403 на каталог,
  // а не проваливается в SPA-фолбэк ниже.
  await app.register(fastifyStatic, { root, index: ['index.html'] });

  // Одностраничное приложение: неизвестный путь — это маршрут роутера,
  // а не отсутствующий файл. Всё, кроме /api, отдаём index.html.
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.sendFile('index.html');
  });
}
