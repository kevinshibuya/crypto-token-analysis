import Fastify, { FastifyInstance } from 'fastify';
import { registerHealthRoute } from './routes/health';
import { registerMarketsRoute } from './routes/markets';
import type { MarketsService } from './services/marketsService';

export interface AppDeps {
  marketsService: MarketsService;
}

export function buildApp(deps: Partial<AppDeps> = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  registerHealthRoute(app);
  if (deps.marketsService) registerMarketsRoute(app, deps.marketsService);
  return app;
}
