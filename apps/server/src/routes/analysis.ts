import type { FastifyInstance } from 'fastify';
import type { AnalysisService, AnalysisRequest } from '../services/analysisService';
import { SUPPORTED_INTERVALS, DEFAULTS, DEFAULT_LOOKBACK, ROUTE_TIMEOUT_MS } from '../config';
import { withTimeout } from '../util/withTimeout';

const bodySchema = {
  type: 'object',
  required: ['coin', 'interval'],
  additionalProperties: false,
  properties: {
    coin: { type: 'string', minLength: 1 },
    interval: { type: 'string', enum: SUPPORTED_INTERVALS as unknown as string[] },
    lookback: { type: 'integer', minimum: 1, maximum: 20000, default: DEFAULT_LOOKBACK },
    force: { type: 'boolean', default: false },
    rsi: {
      type: 'object', default: {},
      properties: { period: { type: 'integer', minimum: 1, default: DEFAULTS.rsiPeriod } },
    },
    movingAverages: {
      type: 'array', default: [],
      items: {
        type: 'object', required: ['type', 'period'],
        properties: { type: { type: 'string', enum: ['SMA', 'EMA'] }, period: { type: 'integer', minimum: 1 } },
      },
    },
    volumeProfile: {
      type: 'object', default: {},
      properties: { rows: { type: 'integer', minimum: 1, maximum: 200, default: DEFAULTS.volumeProfileRows } },
    },
    pivots: {
      type: 'object', default: {},
      properties: {
        lookback: { type: 'integer', minimum: 1, default: DEFAULTS.pivotLookback },
        maxLevels: { type: 'integer', minimum: 1, default: DEFAULTS.pivotMaxLevels },
      },
    },
  },
} as const;

export function registerAnalysisRoute(app: FastifyInstance, svc: AnalysisService, timeoutMs = ROUTE_TIMEOUT_MS): void {
  app.post('/api/analysis', { schema: { body: bodySchema } }, async (req) =>
    withTimeout(svc.analyze(req.body as AnalysisRequest), timeoutMs, 'analysis'));
}
