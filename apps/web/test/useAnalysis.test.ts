import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAnalysis } from '../src/state/useAnalysis';
import * as client from '../src/api/client';
import type { AnalysisConfig } from '../src/api/types';

const cfg: AnalysisConfig = {
  coin: 'BTC', interval: '1h', lookback: 100, rsiPeriod: 14,
  movingAverages: [], volumeProfileRows: 24, pivotLookback: 5, pivotMaxLevels: 6,
};

describe('useAnalysis', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('loads analysis and exposes data', async () => {
    const spy = vi.spyOn(client, 'postAnalysis').mockResolvedValue({ coin: 'BTC' } as never);
    const { result } = renderHook(() => useAnalysis(cfg, 0));
    await waitFor(() => expect(result.current.data).toEqual({ coin: 'BTC' }));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('surfaces errors', async () => {
    vi.spyOn(client, 'postAnalysis').mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useAnalysis(cfg, 0));
    await waitFor(() => expect(result.current.error).toBe('boom'));
  });

  it('sends force: true on reload', async () => {
    const calls: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return { ok: true, json: async () => ({ candles: [], meta: { lastUpdated: 0, candleCount: 0 } }) };
    }));
    const { result } = renderHook(() => useAnalysis(cfg, 0));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect((calls[0] as { force: boolean }).force).toBe(false);
    act(() => result.current.reload());
    await waitFor(() => expect(calls).toHaveLength(2));
    expect((calls[1] as { force: boolean }).force).toBe(true);
  });
});
