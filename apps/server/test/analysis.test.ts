import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app';
import { AnalysisService } from '../src/services/analysisService';

const fakeResult = {
  coin: 'BTC', interval: '1h', candles: [], rsi: [], movingAverages: [],
  volume: { bars: [], sma: [] },
  volumeProfile: { rows: [], poc: 0, valueArea: { low: 0, high: 0 } },
  pivots: [], signals: [], meta: { lastUpdated: 0, candleCount: 0 },
};

describe('POST /api/analysis', () => {
  it('returns analysis for a valid request', async () => {
    const analysisService = { analyze: async () => fakeResult } as any;
    const app = buildApp({ analysisService });
    const res = await app.inject({ method: 'POST', url: '/api/analysis', payload: { coin: 'BTC', interval: '1h' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().coin).toBe('BTC');
  });

  it('rejects an unknown interval with 400', async () => {
    const analysisService = { analyze: async () => fakeResult } as any;
    const app = buildApp({ analysisService });
    const res = await app.inject({ method: 'POST', url: '/api/analysis', payload: { coin: 'BTC', interval: 'nope' } });
    expect(res.statusCode).toBe(400);
  });

  it('accepts a force flag', async () => {
    const analysisService = { analyze: async () => fakeResult } as any;
    const app = buildApp({ analysisService });
    const res = await app.inject({
      method: 'POST', url: '/api/analysis',
      payload: { coin: 'BTC', interval: '1h', force: true },
    });
    expect(res.statusCode).toBe(200);
  });
});

const mkCandle = (t: number, c: number) => ({ t, o: c - 0.5, h: c + 1, l: c - 1, c, v: 5 });

describe('AnalysisService phase 2', () => {
  it('404s on a coin with no candles', async () => {
    const svc = new AnalysisService({ getCandles: async () => [] } as never);
    await expect(svc.analyze({
      coin: 'NOPE', interval: '1h', lookback: 100, force: false,
      rsi: { period: 14 }, movingAverages: [], volumeProfile: { rows: 24 },
      pivots: { lookback: 5, maxLevels: 6 },
    })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('includes detected signals in the response', async () => {
    const candles = Array.from({ length: 60 }, (_, i) => mkCandle(i + 1, 100 + Math.sin(i / 4) * 5));
    const svc = new AnalysisService({ getCandles: async () => candles } as never);
    const res = await svc.analyze({
      coin: 'BTC', interval: '1h', lookback: 60, force: false,
      rsi: { period: 14 }, movingAverages: [], volumeProfile: { rows: 24 },
      pivots: { lookback: 5, maxLevels: 6 },
    });
    expect(Array.isArray(res.signals)).toBe(true);
  });

  it('passes force through to the candle service', async () => {
    let seen: unknown;
    const candles = Array.from({ length: 60 }, (_, i) => mkCandle(i + 1, 100));
    const svc = new AnalysisService({
      getCandles: async (_c: string, _i: string, _l: number, opts: unknown) => { seen = opts; return candles; },
    } as never);
    await svc.analyze({
      coin: 'BTC', interval: '1h', lookback: 60, force: true,
      rsi: { period: 14 }, movingAverages: [], volumeProfile: { rows: 24 },
      pivots: { lookback: 5, maxLevels: 6 },
    });
    expect(seen).toEqual({ force: true });
  });
});
