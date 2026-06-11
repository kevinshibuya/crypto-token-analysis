import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { LiveFeed } from '../src/engine/liveFeed';
import { nullLogger } from '../src/engine/logger';
import { readEvents } from './helpers/sse';

let app: FastifyInstance | null = null;
afterEach(async () => { if (app) { await app.close(); app = null; } });

describe('GET /live', () => {
  it('replays the snapshot first, then streams broadcast events, to multiple clients', async () => {
    const feed = new LiveFeed({ log: nullLogger() });
    app = buildApp({
      live: { feed, snapshot: () => ({ scans: [{ coin: 'BTC' }], alerts: [], health: { wsConnected: true, ts: 1 } }) },
    });
    const base = await app.listen({ port: 0, host: '127.0.0.1' });
    const res1 = await fetch(`${base}/live`, { headers: { accept: 'text/event-stream' } });
    const res2 = await fetch(`${base}/live`, { headers: { accept: 'text/event-stream' } });
    expect(res1.headers.get('content-type')).toContain('text/event-stream');

    // wait for both clients to register before broadcasting
    const t0 = Date.now();
    while (feed.clientCount < 2 && Date.now() - t0 < 3_000) await new Promise((r) => setTimeout(r, 10));
    feed.broadcast('scan', { coin: 'ETH' });

    const [ev1, ev2] = await Promise.all([readEvents(res1.body!, 2), readEvents(res2.body!, 2)]);
    for (const evs of [ev1, ev2]) {
      expect(evs[0].event).toBe('snapshot');
      expect(evs[0].data).toMatchObject({ scans: [{ coin: 'BTC' }] });
      expect(evs[1]).toEqual({ event: 'scan', data: { coin: 'ETH' } });
    }
    feed.destroy();
  });

  it('is absent when live deps are not provided', async () => {
    app = buildApp({});
    const res = await app.inject({ method: 'GET', url: '/live' });
    expect(res.statusCode).toBe(404);
  });
});
