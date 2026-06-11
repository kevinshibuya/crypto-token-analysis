import Fastify, { FastifyInstance } from 'fastify';
import { registerHealthRoute } from './routes/health';
import { registerMarketsRoute } from './routes/markets';
import { registerAnalysisRoute } from './routes/analysis';
import { registerBacktestRoute } from './routes/backtest';
import { registerSignalsRoute } from './routes/signals';
import { registerOptimizeMaRoute } from './routes/optimizeMa';
import type { MarketsService } from './services/marketsService';
import type { AnalysisService } from './services/analysisService';
import type { BacktestService } from './services/backtestService';
import type { SignalsService } from './services/signalsService';
import type { HealthSnapshot } from './engine/metrics';

export interface AppDeps {
  marketsService: MarketsService;
  analysisService: AnalysisService;
  backtestService: BacktestService;
  signalsService: SignalsService;
  engineStatus: () => HealthSnapshot;
  optimizeMa?: (coins?: string[]) => Promise<unknown>;
}

export function buildApp(deps: Partial<AppDeps> & { routeTimeoutMs?: number } = {}): FastifyInstance {
  // reject unknown body fields instead of silently stripping them (Fastify's ajv default
  // is removeAdditional: true) so `additionalProperties: false` actually returns 400
  const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
  registerHealthRoute(app, deps.engineStatus);
  if (deps.marketsService) registerMarketsRoute(app, deps.marketsService);
  if (deps.analysisService) registerAnalysisRoute(app, deps.analysisService, deps.routeTimeoutMs);
  if (deps.backtestService) registerBacktestRoute(app, deps.backtestService, deps.routeTimeoutMs);
  if (deps.signalsService) registerSignalsRoute(app, deps.signalsService, deps.routeTimeoutMs);
  if (deps.optimizeMa) registerOptimizeMaRoute(app, deps.optimizeMa);
  return app;
}
