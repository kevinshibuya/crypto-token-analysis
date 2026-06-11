import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HyperliquidWs } from '../src/engine/ws';
import { nullLogger } from '../src/engine/logger';
import { startFakeHlWs, type FakeHlWs } from './helpers/fakeHlWs';

const flush = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe('HyperliquidWs', () => {
  let fake: FakeHlWs;
  let ws: HyperliquidWs;

  beforeEach(async () => { fake = await startFakeHlWs(); });
  afterEach(async () => { ws?.stop(); await fake.close(); });

  const mk = (over: Partial<ConstructorParameters<typeof HyperliquidWs>[0]> = {}) =>
    new HyperliquidWs({
      url: fake.url, log: nullLogger(),
      silenceMs: 60_000, pingIntervalMs: 30_000, baseBackoffMs: 20, maxBackoffMs: 100, ...over,
    });

  it('subscribes allMids + candle@15m per coin on open and emits typed events', async () => {
    ws = mk();
    ws.setCoins(['BTC', 'ETH']);
    const candles: unknown[] = [];
    const mids: unknown[] = [];
    ws.on('candle', (e) => candles.push(e));
    ws.on('mids', (m) => mids.push(m));
    ws.start();
    await fake.nextConnection();
    await flush();
    expect(fake.received).toEqual(expect.arrayContaining([
      { method: 'subscribe', subscription: { type: 'allMids' } },
      { method: 'subscribe', subscription: { type: 'candle', coin: 'BTC', interval: '15m' } },
      { method: 'subscribe', subscription: { type: 'candle', coin: 'ETH', interval: '15m' } },
    ]));
    fake.sendCandle('BTC', { t: 0, o: 1, h: 2, l: 0.5, c: 1.5, v: 10, n: 3 });
    fake.sendMids({ BTC: 61234.5 });
    await flush();
    expect(candles).toEqual([{ coin: 'BTC', interval: '15m', candle: { t: 0, o: 1, h: 2, l: 0.5, c: 1.5, v: 10, n: 3 } }]);
    expect(mids).toEqual([{ BTC: 61234.5 }]);
  });

  it('setCoins after open subscribes additions and unsubscribes removals', async () => {
    ws = mk();
    ws.setCoins(['BTC']);
    ws.start();
    await fake.nextConnection();
    await flush();
    ws.setCoins(['ETH']);
    await flush();
    expect(fake.received).toEqual(expect.arrayContaining([
      { method: 'subscribe', subscription: { type: 'candle', coin: 'ETH', interval: '15m' } },
      { method: 'unsubscribe', subscription: { type: 'candle', coin: 'BTC', interval: '15m' } },
    ]));
  });

  it('reconnects with resubscribe after a network drop, emitting down then open', async () => {
    ws = mk();
    ws.setCoins(['BTC']);
    const transitions: string[] = [];
    ws.on('down', () => transitions.push('down'));
    ws.on('open', () => transitions.push('open'));
    ws.start();
    await fake.nextConnection();
    await flush();
    fake.received.length = 0;
    fake.dropClients();
    await fake.nextConnection(); // backoff is 20ms in tests
    await flush();
    expect(transitions).toEqual(['open', 'down', 'open']);
    expect(fake.received).toEqual(expect.arrayContaining([
      { method: 'subscribe', subscription: { type: 'candle', coin: 'BTC', interval: '15m' } },
    ]));
  });

  it('force-reconnects when no message arrives within silenceMs', async () => {
    ws = mk({ silenceMs: 80, pingIntervalMs: 10_000 }); // silence far below ping cadence → must trip
    ws.setCoins([]);
    ws.start();
    await fake.nextConnection();
    await fake.nextConnection(); // a second connection proves the silence reconnect fired
    await new Promise<void>((r) => ws.once('open', () => r())); // server accepted; wait for the client side of the handshake
    expect(ws.connected).toBe(true);
  });

  it('sends pings on the ping interval and treats pong as liveness', async () => {
    ws = mk({ pingIntervalMs: 30, silenceMs: 200 });
    ws.setCoins([]);
    ws.start();
    await fake.nextConnection();
    await flush(120);
    const pings = fake.received.filter((m) => (m as { method?: string }).method === 'ping');
    expect(pings.length).toBeGreaterThanOrEqual(2); // pongs keep resetting the silence window — no reconnect
  });
});
