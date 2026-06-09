import Fastify, { FastifyInstance } from 'fastify';
import { registerHealthRoute } from './routes/health';
import { registerMarketsRoute } from './routes/markets';
import { registerAnalysisRoute } from './routes/analysis';
import type { MarketsService } from './services/marketsService';
import type { AnalysisService } from './services/analysisService';

export interface AppDeps {
  marketsService: MarketsService;
  analysisService: AnalysisService;
}

export function buildApp(deps: Partial<AppDeps> = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  registerHealthRoute(app);
  if (deps.marketsService) registerMarketsRoute(app, deps.marketsService);
  if (deps.analysisService) registerAnalysisRoute(app, deps.analysisService);
  return app;
}
