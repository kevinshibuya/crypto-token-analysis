import { useCallback, useEffect, useRef, useState } from 'react';
import { postAnalysis } from '../api/client';
import type { AnalysisConfig, AnalysisResponse } from '../api/types';

export interface UseAnalysis {
  data: AnalysisResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useAnalysis(config: AnalysisConfig, debounceMs = 300): UseAnalysis {
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const forceRef = useRef(false);

  const reload = useCallback(() => { forceRef.current = true; setNonce((n) => n + 1); }, []);
  const key = JSON.stringify(config);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    let cancelled = false;
    timer.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const force = forceRef.current;
        forceRef.current = false;
        const res = await postAnalysis(config, { force });
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, debounceMs);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  return { data, loading, error, reload };
}
