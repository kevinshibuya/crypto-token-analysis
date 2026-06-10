import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, postSignals } from '../api/client';
import type { Interval, Market, TradePlan } from '../api/types';
import type { SignalsSettings } from './signalsSettings';

const CONCURRENCY = 3;

export interface ScanRow {
  coin: string;
  status: 'ok' | 'thin' | 'error';
  plan?: TradePlan; // best ACTIVE plan (plans arrive sorted by score desc)
  error?: string;
}

export interface UseMarketScan {
  rows: ScanRow[];
  done: number;
  total: number;
  scanning: boolean;
  start: () => void;
}

export function useMarketScan(markets: Market[], interval: Interval, settings: SignalsSettings): UseMarketScan {
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [scanning, setScanning] = useState(false);
  const ctrl = useRef<AbortController | null>(null);

  // interval change invalidates the sweep (spec: abort on interval change or re-scan)
  useEffect(() => {
    ctrl.current?.abort();
    setRows([]);
    setDone(0);
    setTotal(0);
    setScanning(false);
  }, [interval]);

  useEffect(() => () => ctrl.current?.abort(), []);

  const start = useCallback(() => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const coins = [...markets]
      .sort((a, b) => b.dayNtlVlm - a.dayNtlVlm)
      .slice(0, settings.scanTopN)
      .map((m) => m.name);
    setRows([]);
    setDone(0);
    setTotal(coins.length);
    setScanning(coins.length > 0);

    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next++;
        if (i >= coins.length || c.signal.aborted) return;
        const coin = coins[i];
        let row: ScanRow;
        try {
          const r = await postSignals(coin, interval, settings, { signal: c.signal });
          row = { coin, status: 'ok', plan: r.plans.find((p) => p.status === 'active') };
        } catch (e) {
          if (c.signal.aborted) return;
          row = e instanceof ApiError && e.status === 422
            ? { coin, status: 'thin' }
            : { coin, status: 'error', error: e instanceof Error ? e.message : String(e) };
        }
        if (c.signal.aborted) return;
        setRows((rs) => [...rs, row]);
        setDone((d) => d + 1);
      }
    };
    void Promise.all(Array.from({ length: Math.min(CONCURRENCY, coins.length) }, worker)).then(() => {
      if (!c.signal.aborted) setScanning(false);
    });
  }, [markets, interval, settings]);

  return { rows, done, total, scanning, start };
}
