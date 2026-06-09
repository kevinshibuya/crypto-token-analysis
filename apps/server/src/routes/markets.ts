import type { FastifyInstance } from 'fastify';
import type { MarketsService } from '../services/marketsService';

export function registerMarketsRoute(app: FastifyInstance, svc: MarketsService): void {
  app.get('/api/markets', async () => svc.getMarkets());
}
