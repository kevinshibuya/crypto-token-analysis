import type { Market } from '../api/types';
import type { Interval } from '../intervals';
import { MarketPicker } from './MarketPicker';
import { TimeframePills } from './TimeframePills';

export type View = 'chart' | 'backtest';

export function Toolbar(props: {
  markets: Market[];
  coin: string;
  interval: Interval;
  view: View;
  onCoin: (c: string) => void;
  onInterval: (i: Interval) => void;
  onView: (v: View) => void;
  onRefresh: () => void;
  status: string;
}) {
  const tab = (v: View, label: string) => (
    <button
      onClick={() => props.onView(v)}
      className={`rounded px-2 py-1 text-xs ${
        props.view === v ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-3 border-b border-slate-800 bg-slate-900 px-3 py-2">
      <MarketPicker markets={props.markets} value={props.coin} onChange={props.onCoin} />
      <div className="flex gap-1">{tab('chart', 'Chart')}{tab('backtest', 'Backtest')}</div>
      <TimeframePills value={props.interval} onChange={props.onInterval} />
      <button
        onClick={props.onRefresh}
        className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
      >
        ↻ Refresh
      </button>
      <span className="ml-auto text-xs text-slate-500">{props.status}</span>
    </div>
  );
}
