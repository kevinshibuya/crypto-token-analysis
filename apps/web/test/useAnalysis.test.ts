import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAnalysis } from '../src/state/useAnalysis';
import * as client from '../src/api/client';
import type { AnalysisConfig } from '../src/api/types';

const cfg: AnalysisConfig = {
  coin: 'BTC', interval: '1h', lookback: 100, rsiPeriod: 14,
  movingAverages: [], volumeProfileRows: 24, pivotLookback: 5, pivotMaxLevels: 6,
};

describe('useAnalysis', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

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
});
