import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLiveFeed, MAX_FEED_ALERTS } from '../src/state/useLiveFeed';

type Listener = (ev: MessageEvent) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  listeners = new Map<string, Listener[]>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close(): void { this.closed = true; }
  emit(type: string, data: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) } as MessageEvent);
  }
}

const scan = (coin: string, interval: string, confidence: number, ts = 1) => ({
  coin, interval, ts, candleCount: 100,
  plan: { direction: 'bullish', setup: ['ma-golden-cross'], entry: 1, stop: 0.9, target: 1.2, rr: 2, confidence },
});
const alert = (coin: string, kind: string, ts: number) => ({
  ts, kind, coin, interval: '1h',
  payload: { kind, identity: `${coin}-${ts}`, coin, interval: '1h', direction: 'bullish', setup: ['ma-golden-cross'], entry: 1, stop: 0.9, target: 1.2, rr: 2, confidence: 80, ts, link: '' },
});

describe('useLiveFeed', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    (globalThis as Record<string, unknown>).EventSource = FakeEventSource;
  });
  afterEach(() => { delete (globalThis as Record<string, unknown>).EventSource; });

  it('seeds state from the snapshot and tracks connection', () => {
    const { result } = renderHook(() => useLiveFeed());
    const es = FakeEventSource.instances[0];
    expect(result.current.connected).toBe(false);
    act(() => { es.onopen?.(); });
    expect(result.current.connected).toBe(true);
    act(() => {
      es.emit('snapshot', {
        scans: [scan('BTC', '1h', 80)],
        alerts: [alert('BTC', 'confirmed-new', 5), alert('BTC', 'digest', 4)],
        health: { wsConnected: true, lastTickAgeMs: 100, queueDepth: 0, busyWorkers: 0, coinsTracked: 5, coinsLive: 5, scansCompleted: 1, ts: 9 },
      });
    });
    expect(result.current.scans).toHaveLength(1);
    expect(result.current.alerts).toHaveLength(1); // digest filtered out
    expect(result.current.health?.wsConnected).toBe(true);
  });

  it('scan events update rows in place by coin×interval', () => {
    const { result } = renderHook(() => useLiveFeed());
    const es = FakeEventSource.instances[0];
    act(() => {
      es.emit('scan', scan('BTC', '1h', 60, 1));
      es.emit('scan', scan('BTC', '4h', 70, 2));
      es.emit('scan', scan('BTC', '1h', 90, 3)); // replaces the first
    });
    expect(result.current.scans).toHaveLength(2);
    const btc1h = result.current.scans.find((s) => s.coin === 'BTC' && s.interval === '1h');
    expect(btc1h?.plan?.confidence).toBe(90);
  });

  it('alert events prepend newest-first, skip digests, and cap the feed', () => {
    const { result } = renderHook(() => useLiveFeed());
    const es = FakeEventSource.instances[0];
    act(() => {
      for (let i = 0; i < MAX_FEED_ALERTS + 10; i++) es.emit('alert', alert('BTC', 'confirmed-new', i));
      es.emit('alert', alert('ETH', 'digest', 999));
    });
    expect(result.current.alerts).toHaveLength(MAX_FEED_ALERTS);
    expect(result.current.alerts[0].ts).toBe(MAX_FEED_ALERTS + 9); // newest first
  });

  it('onerror flips connected off; close on unmount', () => {
    const { result, unmount } = renderHook(() => useLiveFeed());
    const es = FakeEventSource.instances[0];
    act(() => { es.onopen?.(); });
    act(() => { es.onerror?.(); });
    expect(result.current.connected).toBe(false);
    unmount();
    expect(es.closed).toBe(true);
  });
});
