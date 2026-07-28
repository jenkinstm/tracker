import type { FastifyReply, FastifyRequest } from 'fastify';

/** 90 дней — чтобы телефон не разлогинивался (FR-1.0). */
export const SESSION_TTL_SECONDS = 90 * 24 * 60 * 60;

declare module '@fastify/secure-session' {
  interface SessionData {
    userId: string;
  }
}

export function getSessionUserId(request: FastifyRequest): string | undefined {
  return request.session.get('userId');
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!getSessionUserId(request)) {
    await reply.code(401).send({ error: 'unauthorized' });
  }
}
