import { useCallback, useEffect, useRef, useState } from 'react';
import { postSignals } from '../api/client';
import type { Interval, SignalsResult } from '../api/types';
import type { SignalsSettings } from './signalsSettings';

export interface UseSignals {
  data: SignalsResult | null;
  loading: boolean;
  error: string | null;
  reload: () => void; // refetch with force: true
}

export function useSignals(
  coin: string,
  interval: Interval,
  settings: SignalsSettings,
  enabled: boolean,
  debounceMs = 300,
): UseSignals {
  const [data, setData] = useState<SignalsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const forceRef = useRef(false);

  const reload = useCallback(() => { forceRef.current = true; setNonce((n) => n + 1); }, []);
  // scanTopN is scanner-only: exclude it so dragging it doesn't refetch the coin's plans
  const key = JSON.stringify({ coin, interval, gate: settings.gate, weights: settings.weights, window: settings.window });

  useEffect(() => {
    if (!enabled) return;
    const c = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      const force = forceRef.current;
      forceRef.current = false;
      try {
        const r = await postSignals(coin, interval, settings, { force, signal: c.signal });
        if (!c.signal.aborted) setData(r);
      } catch (e) {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    }, debounceMs);
    return () => { clearTimeout(timer); c.abort(); };
  }, [key, nonce, enabled]);

  return { data, loading, error, reload };
}
