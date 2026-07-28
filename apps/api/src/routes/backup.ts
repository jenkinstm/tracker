import { backupCounts, backupSchema, totalRecords } from '@tracker/shared';
import type { FastifyInstance } from 'fastify';

import { exportData, hasUserData, importData } from '../lib/backup.js';
import { getSessionUserId } from '../lib/session.js';

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  /** Экспорт всех данных одним файлом (FR-8.1). */
  app.get('/export', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const backup = await exportData(userId);
    const stamp = backup.exportedAt.slice(0, 10);

    return reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="tracker-${stamp}.json"`)
      .send(backup);
  });

  /** Восстановление из своего JSON (FR-8.3, критерий приёмки №4). */
  app.post('/import', {
    // Дефолтный лимит Fastify — 1 МБ, а годовая история в него не влезет.
    // Поднимаем только здесь: глобально это открыло бы приём мусора на всех ручках.
    bodyLimit: 32 * 1024 * 1024,
  }, async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const body = request.body as { backup?: unknown; replace?: boolean } | undefined;
    const parsed = backupSchema.safeParse(body?.backup);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_backup', details: parsed.error.issues });
    }

    const result = await importData(userId, parsed.data, { replace: body?.replace === true });

    if (!result.ok) {
      // 409, а не 400: с файлом всё в порядке, не в порядке состояние базы.
      const status = result.error === 'not_empty' ? 409 : 400;
      return reply.code(status).send({ error: result.error });
    }

    return reply.send({ ok: true, imported: backupCounts(parsed.data) });
  });

  /** Что сейчас в базе — чтобы интерфейс предупредил о затирании. */
  app.get('/import/status', async (request, reply) => {
    const userId = getSessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    const backup = await exportData(userId);

    return reply.send({ hasData: await hasUserData(userId), records: totalRecords(backup) });
  });
}
