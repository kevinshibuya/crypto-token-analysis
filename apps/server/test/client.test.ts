import { describe, it, expect, vi } from 'vitest';
import { HyperliquidClient } from '../src/hyperliquid/client';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe('HyperliquidClient', () => {
  it('requests candleSnapshot and parses numeric fields', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([{ t: 1, T: 2, o: '1.5', h: '2.0', l: '1.0', c: '1.8', v: '100', n: 5, s: 'BTC', i: '1h' }]),
    );
    const client = new HyperliquidClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const candles = await client.candleSnapshot('BTC', '1h', 0, 10);
    expect(candles).toEqual([{ t: 1, o: 1.5, h: 2, l: 1, c: 1.8, v: 100, n: 5 }]);
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'candleSnapshot',
      req: { coin: 'BTC', interval: '1h', startTime: 0, endTime: 10 },
    });
  });

  it('retries on 429 then throws with status when exhausted', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 429));
    const client = new HyperliquidClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRetries: 2,
      sleep: async () => {},
    });
    await expect(client.candleSnapshot('BTC', '1h', 0, 10)).rejects.toMatchObject({ status: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('retries a transient 429 then succeeds', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return calls === 1
        ? jsonResponse({}, false, 429)
        : jsonResponse([{ t: 1, T: 2, o: '1', h: '1', l: '1', c: '1', v: '1', n: 0, s: 'BTC', i: '1h' }]);
    });
    const client = new HyperliquidClient({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} });
    const candles = await client.candleSnapshot('BTC', '1h', 0, 10);
    expect(candles).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
