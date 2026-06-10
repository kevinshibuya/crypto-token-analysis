import type { FastifyInstance } from 'fastify';
import { DEFAULT_GATE, DEFAULT_WEIGHTS, DEFAULT_WINDOW } from '@cta/core';
import type { SignalsService, SignalsRequest } from '../services/signalsService';
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
        window: { type: 'integer', minimum: 1, maximum: 50, default: DEFAULT_WINDOW },
        force: { type: 'boolean', default: false },
        gate: {
          type: 'object', default: {}, additionalProperties: false,
          properties: {
            minTrades: { type: 'integer', minimum: 0, default: DEFAULT_GATE.minTrades },
            minExpectancy: { type: 'number', default: DEFAULT_GATE.minExpectancy },
            topN: { type: 'integer', minimum: 1, maximum: 50, default: DEFAULT_GATE.topN },
          },
        },
        weights: {
          type: 'object', default: {}, additionalProperties: false,
          properties: {
            edge: { type: 'number', minimum: 0, default: DEFAULT_WEIGHTS.edge },
            sample: { type: 'number', minimum: 0, default: DEFAULT_WEIGHTS.sample },
            confluence: { type: 'number', minimum: 0, default: DEFAULT_WEIGHTS.confluence },
            bracket: { type: 'number', minimum: 0, default: DEFAULT_WEIGHTS.bracket },
          },
        },
      },
    },
  },
} as const;

export function registerSignalsRoute(app: FastifyInstance, svc: SignalsService, timeoutMs = ROUTE_TIMEOUT_MS): void {
  app.post('/api/signals', { schema: { body: bodySchema } }, async (req) =>
    withTimeout(svc.run(req.body as SignalsRequest), timeoutMs, 'signals'));
}
