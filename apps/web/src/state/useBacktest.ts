import { useCallback, useEffect, useRef, useState } from 'react';
import { postBacktest } from '../api/client';
import type { BacktestResponse, BacktestRunConfig, Interval } from '../api/types';

export interface UseBacktest {
  result: BacktestResponse | null;
  loading: boolean;
  error: string | null;
  run: (cfg: BacktestRunConfig) => Promise<void>;
}

export function useBacktest(coin: string, interval: Interval): UseBacktest {
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  // coin/interval change invalidates any in-flight or shown result
  useEffect(() => {
    ctrl.current?.abort();
    setResult(null);
    setError(null);
    setLoading(false);
  }, [coin, interval]);

  useEffect(() => () => ctrl.current?.abort(), []);

  const run = useCallback(async (cfg: BacktestRunConfig) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLoading(true);
    setError(null);
    try {
      const r = await postBacktest(coin, interval, cfg, c.signal);
      if (!c.signal.aborted) setResult(r);
    } catch (e) {
      if (!c.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
  }, [coin, interval]);

  return { result, loading, error, run };
}
