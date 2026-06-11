import type { FastifyInstance } from 'fastify';
import type { HealthSnapshot } from '../engine/metrics';

const startedAt = Date.now();

export function registerHealthRoute(app: FastifyInstance, engineStatus?: () => HealthSnapshot): void {
  app.get('/api/health', async () => {
    const base = {
      status: 'ok',
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    };
    return engineStatus ? { ...base, engine: engineStatus() } : base;
  });
}
