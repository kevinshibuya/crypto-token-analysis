import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app';
import { BacktestService } from '../src/services/backtestService';
import { openDb } from '../src/cache/db';
import { BacktestStore } from '../src/cache/backtestStore';
import type { Candle } from '@cta/core';

function mkCandles(n: number): Candle[] {
  const out: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 7) * 2 + (i % 11 === 0 ? -3 : 0.3);
    const o = price;
    const c = Math.max(5, price + drift);
    out.push({ t: i + 1, o, h: Math.max(o, c) + 1.5, l: Math.min(o, c) - 1.5, c, v: i % 13 === 0 ? 30 : 5 });
    price = c;
  }
  return out;
}

const appWith = (candles: Candle[]) => {
  const store = new BacktestStore(openDb(':memory:'));
  const candleService = { getCandles: async () => candles } as never;
  return buildApp({ backtestService: new BacktestService(candleService, store) });
};

const post = (app: ReturnType<typeof buildApp>, payload: object) =>
  app.inject({ method: 'POST', url: '/api/backtest', payload: { coin: 'BTC', interval: '1h', ...payload } });

describe('POST /api/backtest', () => {
  it('runs a ranked scan', async () => {
    const res = await post(appWith(mkCandles(300)), {});
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cached).toBe(false);
    expect(body.results.length).toBeGreaterThan(0);
    for (let i = 1; i < body.results.length; i++) {
      expect(body.results[i].metrics.expectancy).toBeLessThanOrEqual(body.results[i - 1].metrics.expectancy);
    }
  });

  it('serves a repeat request from cache', async () => {
    const app = appWith(mkCandles(300));
    await post(app, {});
    const res = await post(app, {});
    expect(res.json().cached).toBe(true);
  });

  it('recomputes when config differs', async () => {
    const app = appWith(mkCandles(300));
    await post(app, {});
    const res = await post(app, { config: { minRR: 2 } });
    expect(res.json().cached).toBe(false);
  });

  it('backtests a custom signal set', async () => {
    const res = await post(appWith(mkCandles(300)), { config: { signalKinds: ['volume-spike-up'] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().results).toHaveLength(1);
    expect(res.json().results[0].kinds).toEqual(['volume-spike-up']);
  });

  it('rejects unknown signal kinds with 400', async () => {
    const res = await post(appWith(mkCandles(300)), { config: { signalKinds: ['nope'] } });
    expect(res.statusCode).toBe(400);
  });

  it('404s when there are no candles', async () => {
    const res = await post(appWith([]), {});
    expect(res.statusCode).toBe(404);
  });

  it('422s below the minimum candle count', async () => {
    const res = await post(appWith(mkCandles(10)), {});
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toContain('50');
  });

  it('cache key is order-independent for signal kinds', async () => {
    const app = appWith(mkCandles(300));
    await post(app, { config: { signalKinds: ['volume-spike-up', 'hammer'] } });
    const res = await post(app, { config: { signalKinds: ['hammer', 'volume-spike-up'] } });
    expect(res.json().cached).toBe(true);
  });
});
