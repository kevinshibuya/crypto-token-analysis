import type { FastifyInstance } from 'fastify';
import type { BacktestService, BacktestRequest } from '../services/backtestService';
import { SUPPORTED_INTERVALS, BACKTEST_DEFAULT_LOOKBACK, ROUTE_TIMEOUT_MS } from '../config';
import { withTimeout } from '../util/withTimeout';

const bodySchema = {
  type: 'object',
  required: ['coin', 'interval'],
  additionalProperties: false,
  properties: {
    coin: { type: 'string', minLength: 1 },
    interval: { type: 'string', enum: SUPPORTED_INTERVALS as unknown as string[] },
    lookback: { type: 'integer', minimum: 1, maximum: 20000, default: BACKTEST_DEFAULT_LOOKBACK },
    config: {
      type: 'object', default: {}, additionalProperties: false,
      properties: {
        confluenceWindow: { type: 'integer', minimum: 0, maximum: 20, default: 3 },
        minRR: { type: 'number', minimum: 0, default: 1.5 },
        volumeSpikeK: { type: 'number', exclusiveMinimum: 0, default: 2 },
        signalKinds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 },
      },
    },
  },
} as const;

export function registerBacktestRoute(app: FastifyInstance, svc: BacktestService, timeoutMs = ROUTE_TIMEOUT_MS): void {
  app.post('/api/backtest', { schema: { body: bodySchema } }, async (req) =>
    withTimeout(svc.run(req.body as BacktestRequest), timeoutMs, 'backtest'));
}
