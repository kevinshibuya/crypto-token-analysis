// apps/server/test/liveFeed.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { LiveFeed, sseFrame } from '../src/engine/liveFeed';
import { nullLogger } from '../src/engine/logger';

/** Minimal ServerResponse stand-in: scripted write() returns, captured chunks, drain/close events. */
class FakeRes extends EventEmitter {
  chunks: string[] = [];
  writeReturns: boolean[] = [];
  ended = false;
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return this.writeReturns.length ? this.writeReturns.shift()! : true;
  }
  end(): void { this.ended = true; }
}

describe('sseFrame', () => {
  it('formats an SSE frame', () => {
    expect(sseFrame('scan', { a: 1 })).toBe('event: scan\ndata: {"a":1}\n\n');
  });
});

describe('LiveFeed', () => {
  let feed: LiveFeed;
  beforeEach(() => { feed = new LiveFeed({ log: nullLogger(), maxBuffered: 3, heartbeatMs: 60_000 }); });
  afterEach(() => { feed.destroy(); });

  it('replays snapshot frames on connect and broadcasts to every client', () => {
    const a = new FakeRes(); const b = new FakeRes();
    feed.addClient(a as never, [sseFrame('snapshot', { n: 1 })]);
    feed.addClient(b as never, [sseFrame('snapshot', { n: 2 })]);
    expect(a.chunks[0]).toContain('"n":1');
    expect(b.chunks[0]).toContain('"n":2');
    feed.broadcast('scan', { coin: 'BTC' });
    expect(a.chunks.some((c) => c.startsWith('event: scan'))).toBe(true);
    expect(b.chunks.some((c) => c.startsWith('event: scan'))).toBe(true);
    expect(feed.clientCount).toBe(2);
  });

  it('buffers for a blocked client and flushes on drain, preserving order', () => {
    const res = new FakeRes();
    res.writeReturns = [false]; // first write blocks
    feed.addClient(res as never, []);
    feed.broadcast('scan', { i: 1 }); // written, returns false → blocked
    feed.broadcast('scan', { i: 2 }); // buffered
    feed.broadcast('scan', { i: 3 }); // buffered
    expect(res.chunks).toHaveLength(1);
    res.emit('drain');
    expect(res.chunks.map((c) => c.match(/"i":(\d)/)![1])).toEqual(['1', '2', '3']);
  });

  it('drops oldest beyond maxBuffered, never blocking the broadcaster', () => {
    const res = new FakeRes();
    res.writeReturns = [false];
    feed.addClient(res as never, []);
    feed.broadcast('scan', { i: 0 }); // blocks
    for (let i = 1; i <= 5; i++) feed.broadcast('scan', { i }); // 5 buffered, cap 3 → drop 1,2
    res.emit('drain');
    expect(res.chunks.map((c) => c.match(/"i":(\d)/)![1])).toEqual(['0', '3', '4', '5']);
  });

  it('removes a client on close and on write error', () => {
    const a = new FakeRes(); const b = new FakeRes();
    feed.addClient(a as never, []);
    feed.addClient(b as never, []);
    a.emit('close');
    expect(feed.clientCount).toBe(1);
    b.write = () => { throw new Error('EPIPE'); };
    feed.broadcast('scan', {});
    expect(feed.clientCount).toBe(0);
  });

  it('heartbeats all clients on the configured interval', () => {
    vi.useFakeTimers();
    try {
      const hb = new LiveFeed({ log: nullLogger(), heartbeatMs: 1_000 });
      const res = new FakeRes();
      hb.addClient(res as never, []);
      vi.advanceTimersByTime(2_100);
      expect(res.chunks.filter((c) => c.startsWith(':')).length).toBeGreaterThanOrEqual(2);
      hb.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('destroy ends every client connection', () => {
    const res = new FakeRes();
    feed.addClient(res as never, []);
    feed.destroy();
    expect(res.ended).toBe(true);
    expect(feed.clientCount).toBe(0);
  });
});
