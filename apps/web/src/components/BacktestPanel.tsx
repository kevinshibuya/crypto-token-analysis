import { useState } from 'react';
import { SIGNAL_KINDS } from '@cta/core';
import { useBacktest } from '../state/useBacktest';
import { BacktestTable } from './BacktestTable';
import type { Interval, SignalKind } from '../api/types';

export function BacktestPanel({ coin, interval }: { coin: string; interval: Interval }) {
  const [minRR, setMinRR] = useState(1.5);
  const [confluenceWindow, setConfluenceWindow] = useState(3);
  const [volumeSpikeK, setVolumeSpikeK] = useState(2);
  const [selected, setSelected] = useState<SignalKind[]>([]);
  const scan = useBacktest(coin, interval);
  const custom = useBacktest(coin, interval);

  const cfg = { confluenceWindow, minRR, volumeSpikeK };
  const toggleKind = (k: SignalKind) =>
    setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : s.length < 2 ? [...s, k] : s));

  const numberField = (label: string, value: number, set: (n: number) => void, step = 0.1) => (
    <label className="flex items-center gap-1 text-xs text-slate-400">
      {label}
      <input
        type="number" min={0} step={step} value={value}
        onChange={(e) => { const n = Number(e.target.value); if (e.target.value !== '' && !Number.isNaN(n)) set(n); }}
        className="w-16 rounded bg-slate-800 px-1 py-0.5 text-right text-slate-200"
      />
    </label>
  );

  const loading = scan.loading || custom.loading;
  const error = scan.error ?? custom.error;
  const pinned = custom.result?.results[0] ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3">
      <div className="flex flex-wrap items-center gap-4">
        {numberField('min R/R', minRR, setMinRR)}
        {numberField('confluence', confluenceWindow, setConfluenceWindow, 1)}
        {numberField('vol spike k', volumeSpikeK, setVolumeSpikeK)}
        <button
          onClick={() => void scan.run(cfg)}
          disabled={loading}
          className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Run scan
        </button>
        {loading && <span className="text-xs text-slate-400">scanning {coin} {interval}…</span>}
        {scan.result?.cached && <span className="text-xs text-slate-500">cached</span>}
      </div>

      <details className="text-xs text-slate-400">
        <summary className="cursor-pointer select-none">
          Custom set ({selected.length ? selected.join(' + ') : 'pick 1–2 signals'})
        </summary>
        <div className="mt-1 grid grid-cols-3 gap-1 md:grid-cols-5">
          {SIGNAL_KINDS.map((k) => (
            <label key={k} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={selected.includes(k)}
                disabled={!selected.includes(k) && selected.length >= 2}
                onChange={() => toggleKind(k)}
              />
              {k}
            </label>
          ))}
        </div>
        <button
          onClick={() => void custom.run({ ...cfg, signalKinds: selected })}
          disabled={loading || selected.length === 0}
          className="mt-1 rounded bg-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-50"
        >
          Test selection
        </button>
      </details>

      {error && <div className="rounded bg-red-950 px-2 py-1 text-xs text-red-300">{error}</div>}
      {scan.result || pinned ? (
        <BacktestTable results={scan.result?.results ?? []} pinned={pinned} />
      ) : (
        !loading && <p className="text-xs text-slate-500">Run a scan to rank signal setups for {coin} {interval}.</p>
      )}
    </div>
  );
}
