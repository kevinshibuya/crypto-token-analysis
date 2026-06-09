import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app';

const fakeResult = {
  coin: 'BTC', interval: '1h', candles: [], rsi: [], movingAverages: [],
  volume: { bars: [], sma: [] },
  volumeProfile: { rows: [], poc: 0, valueArea: { low: 0, high: 0 } },
  pivots: [], meta: { lastUpdated: 0, candleCount: 0 },
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
});
