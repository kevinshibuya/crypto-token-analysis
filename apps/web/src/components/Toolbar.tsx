import type { Market } from '../api/types';
import type { Interval } from '../intervals';
import { MarketPicker } from './MarketPicker';
import { TimeframePills } from './TimeframePills';

export function Toolbar(props: {
  markets: Market[];
  coin: string;
  interval: Interval;
  onCoin: (c: string) => void;
  onInterval: (i: Interval) => void;
  onRefresh: () => void;
  status: string;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-800 bg-slate-900 px-3 py-2">
      <MarketPicker markets={props.markets} value={props.coin} onChange={props.onCoin} />
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
