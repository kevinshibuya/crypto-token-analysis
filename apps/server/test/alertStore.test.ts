// apps/server/test/alertStore.test.ts
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/cache/db';
import { AlertStore } from '../src/cache/alertStore';

const row = (over: Partial<Parameters<AlertStore['insert']>[0]> = {}) => ({
  ts: 1000, kind: 'confirmed-new' as const, identity: 'BTC|1h|long|rsi-oversold|110532',
  coin: 'BTC', interval: '1h', payload: { entry: 100, stop: 95, target: 110, confidence: 70 },
  delivered: ['telegram'], ...over,
});

describe('AlertStore', () => {
  it('inserts and lists alerts newest-first', () => {
    const store = new AlertStore(openDb(':memory:'));
    store.insert(row({ ts: 1000 }));
    store.insert(row({ ts: 2000, kind: 'provisional-new' }));
    const out = store.recent(10);
    expect(out).toHaveLength(2);
    expect(out[0].ts).toBe(2000);
    expect(out[0].kind).toBe('provisional-new');
    expect(out[1].payload).toEqual({ entry: 100, stop: 95, target: 110, confidence: 70 });
  });

  it('records and reads per-(identity,kind) last-fired timestamps', () => {
    const store = new AlertStore(openDb(':memory:'));
    expect(store.lastFired('id1', 'confirmed-new')).toBeNull();
    store.markFired('id1', 'confirmed-new', 5000);
    expect(store.lastFired('id1', 'confirmed-new')).toBe(5000);
    store.markFired('id1', 'confirmed-new', 9000); // upsert
    expect(store.lastFired('id1', 'confirmed-new')).toBe(9000);
    expect(store.lastFired('id1', 'provisional-new')).toBeNull(); // kind-scoped
  });

  it('loads the full dedupe table for warm-boot cache priming', () => {
    const store = new AlertStore(openDb(':memory:'));
    store.markFired('a', 'confirmed-new', 1);
    store.markFired('b', 'provisional-new', 2);
    expect(store.allFired()).toEqual(new Map([['a|confirmed-new', 1], ['b|provisional-new', 2]]));
  });
});
