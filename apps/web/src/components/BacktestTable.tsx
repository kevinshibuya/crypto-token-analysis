import { useMemo, useState } from 'react';
import type { SetupResult } from '../api/types';

const LOW_SAMPLE = 20;

type Column = { key: string; label: string; value: (r: SetupResult) => number };
const COLUMNS: Column[] = [
  { key: 'trades', label: 'trades', value: (r) => r.metrics.trades },
  { key: 'winRate', label: 'win %', value: (r) => r.metrics.winRate },
  { key: 'avgR', label: 'avg R', value: (r) => r.metrics.avgR },
  { key: 'profitFactor', label: 'PF', value: (r) => r.metrics.profitFactor ?? Number.POSITIVE_INFINITY },
  { key: 'expectancy', label: 'expectancy', value: (r) => r.metrics.expectancy },
  { key: 'maxDrawdownR', label: 'max DD', value: (r) => r.metrics.maxDrawdownR },
  { key: 'filtered', label: 'filtered', value: (r) => r.metrics.filtered },
];

const fmt = {
  pct: (x: number) => `${(x * 100).toFixed(0)}%`,
  r: (x: number) => `${x.toFixed(2)}R`,
  pf: (x: number | null) => (x === null ? '∞' : x.toFixed(2)),
};

function Row({ r, pinned }: { r: SetupResult; pinned?: boolean }) {
  const low = r.metrics.trades < LOW_SAMPLE;
  return (
    <tr
      data-testid={pinned ? 'bt-pinned' : 'bt-row'}
      className={`border-b border-slate-800 ${pinned ? 'bg-slate-800/60' : ''} ${low ? 'opacity-50' : ''}`}
    >
      <td className="px-2 py-1 text-left">
        {r.kinds.join(' + ')}
        {low && <span className="ml-2 rounded bg-slate-700 px-1 text-[10px] text-slate-300">low sample</span>}
        {pinned && <span className="ml-2 rounded bg-blue-900 px-1 text-[10px] text-blue-200">selection</span>}
      </td>
      <td className="px-2 py-1 text-right">{r.metrics.longTrades}L/{r.metrics.shortTrades}S</td>
      <td className="px-2 py-1 text-right">{r.metrics.trades}</td>
      <td className="px-2 py-1 text-right">{fmt.pct(r.metrics.winRate)}</td>
      <td className="px-2 py-1 text-right">{fmt.r(r.metrics.avgR)}</td>
      <td className="px-2 py-1 text-right">{fmt.pf(r.metrics.profitFactor)}</td>
      <td className="px-2 py-1 text-right">{fmt.r(r.metrics.expectancy)}</td>
      <td className="px-2 py-1 text-right">{fmt.r(r.metrics.maxDrawdownR)}</td>
      <td className="px-2 py-1 text-right">{r.metrics.filtered}</td>
    </tr>
  );
}

export function BacktestTable({ results, pinned }: { results: SetupResult[]; pinned: SetupResult | null }) {
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: 'expectancy', desc: true });
  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key)!;
    return [...results].sort((a, b) => (sort.desc ? col.value(b) - col.value(a) : col.value(a) - col.value(b)));
  }, [results, sort]);
  const header = (c: Column) => (
    <th key={c.key} className="px-2 py-1 text-right">
      <button
        onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : true }))}
        className="text-xs uppercase tracking-wide text-slate-400 hover:text-slate-200"
      >
        {c.label}{sort.key === c.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  );
  return (
    <table className="w-full border-collapse text-xs text-slate-200">
      <thead>
        <tr className="border-b border-slate-700">
          <th className="px-2 py-1 text-left text-xs uppercase tracking-wide text-slate-400">setup</th>
          <th className="px-2 py-1 text-right text-xs uppercase tracking-wide text-slate-400">dir</th>
          {COLUMNS.map(header)}
        </tr>
      </thead>
      <tbody>
        {pinned && <Row r={pinned} pinned />}
        {sorted.map((r) => <Row key={r.kinds.join('+')} r={r} />)}
      </tbody>
    </table>
  );
}
