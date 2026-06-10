import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMarketScan } from '../src/state/useMarketScan';
import { DEFAULT_SIGNALS_SETTINGS } from '../src/state/signalsSettings';
import type { Interval, Market } from '../src/api/types';

afterEach(() => { vi.unstubAllGlobals(); });

const mk = (name: string, vol: number): Market => ({ name, szDecimals: 2, maxLeverage: 50, dayNtlVlm: vol });
const markets = [mk('LOW', 1), mk('BTC', 100), mk('ETH', 50), mk('SOL', 25)];
const settings = { ...DEFAULT_SIGNALS_SETTINGS, scanTopN: 3 };

const plan = (score: number, status = 'active') => ({
  setup: ['hammer'], direction: 'bullish', signalT: 1, ageCandles: 0,
  entry: 100, stop: 95, target: 110, rr: 2, status,
  metrics: {}, confidence: { edge: 0, sample: 0, confluence: 0, bracket: 0, score },
});

const respondWith = (byCoin: Record<string, () => Response | Promise<Response>>) =>
  vi.fn(async (_url: string, init: RequestInit) => {
    const { coin } = JSON.parse(init.body as string) as { coin: string };
    return byCoin[coin]();
  });

const ok = (coin: string, plans: unknown[]) =>
  new Response(JSON.stringify({ coin, interval: '1h', plans, qualifiedCount: 1, candleCount: 100, lastCandleT: 1 }));

describe('useMarketScan', () => {
  it('sweeps top-N by volume, counts progress, ranks by best active plan, omits no-active coins', async () => {
    vi.stubGlobal('fetch', respondWith({
      BTC: () => ok('BTC', [plan(80)]),
      ETH: () => ok('ETH', [plan(40, 'expired')]),   // no active plan → omitted from ranking
      SOL: () => ok('SOL', [plan(90)]),
    }));
    const { result } = renderHook(() => useMarketScan(markets, '1h', settings));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.scanning).toBe(false));
    expect(result.current.total).toBe(3);            // LOW (lowest volume) not scanned
    expect(result.current.done).toBe(3);
    const ranked = result.current.rows.filter((r) => r.status === 'ok' && r.plan);
    expect(ranked.map((r) => r.coin).sort()).toEqual(['BTC', 'SOL']);
  });

  it('classifies 422 as thin and other failures as error rows, sweep continues', async () => {
    vi.stubGlobal('fetch', respondWith({
      BTC: () => ok('BTC', [plan(80)]),
      ETH: () => new Response('thin', { status: 422 }),
      SOL: () => new Response('boom', { status: 500 }),
    }));
    const { result } = renderHook(() => useMarketScan(markets, '1h', settings));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.done).toBe(3));
    expect(result.current.rows.find((r) => r.coin === 'ETH')?.status).toBe('thin');
    expect(result.current.rows.find((r) => r.coin === 'SOL')?.status).toBe('error');
    expect(result.current.rows.find((r) => r.coin === 'BTC')?.status).toBe('ok');
  });

  it('aborts and resets when the interval changes mid-scan', async () => {
    let resolveBTC!: () => void;
    vi.stubGlobal('fetch', respondWith({
      BTC: () => new Promise<Response>((res) => { resolveBTC = () => res(ok('BTC', [plan(80)])); }),
      ETH: () => ok('ETH', [plan(40)]),
      SOL: () => ok('SOL', [plan(90)]),
    }));
    const { result, rerender } = renderHook(
      ({ interval }: { interval: Interval }) => useMarketScan(markets, interval, settings),
      { initialProps: { interval: '1h' as Interval } },
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.total).toBe(3));
    rerender({ interval: '4h' });
    expect(result.current.rows).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.scanning).toBe(false);
    resolveBTC(); // late resolution must not resurrect state
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.rows).toEqual([]);
  });

  it('caps in-flight requests at 3', async () => {
    let inFlight = 0;
    let peak = 0;
    const many = [...markets, mk('AAA', 10), mk('BBB', 9)];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      const { coin } = JSON.parse(init.body as string) as { coin: string };
      return ok(coin, [plan(50)]);
    }));
    const { result } = renderHook(() => useMarketScan(many, '1h', { ...settings, scanTopN: 6 }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.scanning).toBe(false));
    expect(peak).toBeLessThanOrEqual(3);
    expect(result.current.done).toBe(6);
  });
});
