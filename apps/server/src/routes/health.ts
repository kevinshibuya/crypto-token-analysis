import type { FastifyInstance } from 'fastify';

const startedAt = Date.now();

export function registerHealthRoute(app: FastifyInstance): void {
  app.get('/api/health', async () => ({
    status: 'ok',
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
  }));
}
