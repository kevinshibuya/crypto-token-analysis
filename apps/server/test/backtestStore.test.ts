import { describe, it, expect } from 'vitest';
import { openDb } from '../src/cache/db';
import { BacktestStore } from '../src/cache/backtestStore';

describe('BacktestStore', () => {
  it('round-trips a payload by exact key', () => {
    const store = new BacktestStore(openDb(':memory:'));
    const payload = { results: [{ kinds: ['hammer'], metrics: { trades: 3 } }], cached: false };
    store.set('BTC', '1h', 'abc', 1000, payload);
    expect(store.get('BTC', '1h', 'abc', 1000)).toEqual(payload);
  });
  it('misses on any key difference', () => {
    const store = new BacktestStore(openDb(':memory:'));
    store.set('BTC', '1h', 'abc', 1000, { x: 1 });
    expect(store.get('BTC', '1h', 'abc', 2000)).toBeNull();   // new candle head
    expect(store.get('BTC', '1h', 'zzz', 1000)).toBeNull();   // different config
    expect(store.get('ETH', '1h', 'abc', 1000)).toBeNull();
  });
  it('overwrites on conflict', () => {
    const store = new BacktestStore(openDb(':memory:'));
    store.set('BTC', '1h', 'abc', 1000, { x: 1 });
    store.set('BTC', '1h', 'abc', 1000, { x: 2 });
    expect(store.get('BTC', '1h', 'abc', 1000)).toEqual({ x: 2 });
  });
});
