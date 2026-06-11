import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { LiveFeed } from '../src/engine/liveFeed';
import { nullLogger } from '../src/engine/logger';

let app: FastifyInstance | null = null;
afterEach(async () => { if (app) { await app.close(); app = null; } });

/** Read SSE frames from a fetch body until `count` event frames arrived (or timeout). */
async function readEvents(body: ReadableStream<Uint8Array>, count: number, timeoutMs = 5_000):
  Promise<{ event: string; data: unknown }[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const events: { event: string; data: unknown }[] = [];
  let buf = '';
  const deadline = Date.now() + timeoutMs;
  while (events.length < count && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const ev = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
    }
  }
  await reader.cancel().catch(() => {});
  return events;
}

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
