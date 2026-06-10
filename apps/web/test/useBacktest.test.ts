import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useBacktest } from '../src/state/useBacktest';

const scanResponse = { results: [], candleCount: 300, lastCandleT: 300, cached: false };
const cfg = { confluenceWindow: 3, minRR: 1.5, volumeSpikeK: 2 };

describe('useBacktest', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('runs a scan and stores the result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => scanResponse })));
    const { result } = renderHook(() => useBacktest('BTC', '1h'));
    act(() => { void result.current.run(cfg); });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.result).toEqual(scanResponse));
    expect(result.current.loading).toBe(false);
  });

  it('clears state and aborts when coin changes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => scanResponse })));
    const { result, rerender } = renderHook(({ coin }) => useBacktest(coin, '1h'), {
      initialProps: { coin: 'BTC' },
    });
    act(() => { void result.current.run(cfg); });
    await waitFor(() => expect(result.current.result).not.toBeNull());
    rerender({ coin: 'ETH' });
    expect(result.current.result).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('surfaces server errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 422 })));
    const { result } = renderHook(() => useBacktest('BTC', '1h'));
    act(() => { void result.current.run(cfg); });
    await waitFor(() => expect(result.current.error).toContain('422'));
  });

  it('discards in-flight result when coin changes mid-request', async () => {
    let resolve!: (v: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => { resolve = r; })));
    const { result, rerender } = renderHook(({ coin }) => useBacktest(coin, '1h'), {
      initialProps: { coin: 'BTC' },
    });
    act(() => { void result.current.run(cfg); });
    expect(result.current.loading).toBe(true);
    rerender({ coin: 'ETH' }); // aborts the in-flight request
    await act(async () => {
      resolve({ ok: true, json: async () => scanResponse }); // response lands after abort
    });
    expect(result.current.result).toBeNull(); // guard must have suppressed it
    expect(result.current.loading).toBe(false);
  });
});
