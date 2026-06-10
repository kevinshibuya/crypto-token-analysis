import type { Interval, Market, TradePlan } from '../api/types';

export interface SignalsPanelProps {
  coin: string;
  interval: Interval;
  markets: Market[];
  active: boolean;
  onCoin: (c: string) => void;
  onViewPlan: (p: TradePlan) => void;
}

export function SignalsPanel({ coin, interval }: SignalsPanelProps) {
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3 text-xs text-slate-400">
      Signals for {coin} {interval} — coming in Tasks 12–14.
    </div>
  );
}
