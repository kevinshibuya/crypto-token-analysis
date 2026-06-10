import Fastify, { FastifyInstance } from 'fastify';
import { registerHealthRoute } from './routes/health';
import { registerMarketsRoute } from './routes/markets';
import { registerAnalysisRoute } from './routes/analysis';
import { registerBacktestRoute } from './routes/backtest';
import type { MarketsService } from './services/marketsService';
import type { AnalysisService } from './services/analysisService';
import type { BacktestService } from './services/backtestService';

export interface AppDeps {
  marketsService: MarketsService;
  analysisService: AnalysisService;
  backtestService: BacktestService;
}

export function buildApp(deps: Partial<AppDeps> = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  registerHealthRoute(app);
  if (deps.marketsService) registerMarketsRoute(app, deps.marketsService);
  if (deps.analysisService) registerAnalysisRoute(app, deps.analysisService);
  if (deps.backtestService) registerBacktestRoute(app, deps.backtestService);
  return app;
}
