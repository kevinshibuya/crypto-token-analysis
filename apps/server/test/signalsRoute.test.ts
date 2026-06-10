import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app';
import type { SignalsService } from '../src/services/signalsService';

const fakeSvc = (impl: (req: unknown) => unknown) =>
  ({ run: async (r: unknown) => impl(r) }) as unknown as SignalsService;

describe('POST /api/signals', () => {
  it('applies schema defaults and returns the service payload', async () => {
    let seen: any;
    const app = buildApp({
      signalsService: fakeSvc((r) => {
        seen = r;
        return { coin: 'BTC', interval: '1h', plans: [], qualifiedCount: 0, candleCount: 100, lastCandleT: 1 };
      }),
    });
    const res = await app.inject({ method: 'POST', url: '/api/signals', payload: { coin: 'BTC', interval: '1h' } });
    expect(res.statusCode).toBe(200);
    expect(seen.config.gate).toEqual({ minTrades: 20, minExpectancy: 0.1, topN: 10 });
    expect(seen.config.weights).toEqual({ edge: 0.4, sample: 0.2, confluence: 0.2, bracket: 0.2 });
    expect(seen.config.window).toBe(3);
    expect(seen.config.force).toBe(false);
    expect(seen.lookback).toBe(2000);
  });

  it('rejects malformed config with 400', async () => {
    const app = buildApp({ signalsService: fakeSvc(() => ({})) });
    for (const payload of [
      { coin: 'BTC', interval: 'nope' },
      { coin: 'BTC', interval: '1h', config: { gate: { minTrades: -1 } } },
      { coin: 'BTC', interval: '1h', config: { weights: { edge: -0.1 } } },
      { coin: 'BTC', interval: '1h', config: { bogus: 1 } },
    ]) {
      const res = await app.inject({ method: 'POST', url: '/api/signals', payload });
      expect(res.statusCode).toBe(400);
    }
  });

  it('propagates service status codes (404/422)', async () => {
    for (const code of [404, 422]) {
      const app = buildApp({
        signalsService: fakeSvc(() => {
          throw Object.assign(new Error('x'), { statusCode: code });
        }),
      });
      const res = await app.inject({ method: 'POST', url: '/api/signals', payload: { coin: 'Z', interval: '1h' } });
      expect(res.statusCode).toBe(code);
    }
  });

  it('times out via the shared route timeout (504)', async () => {
    const app = buildApp({
      signalsService: fakeSvc(() => new Promise(() => {})),
      routeTimeoutMs: 20,
    });
    const res = await app.inject({ method: 'POST', url: '/api/signals', payload: { coin: 'BTC', interval: '1h' } });
    expect(res.statusCode).toBe(504);
  });
});
