import type { TradePlan } from '../api/types';

const fmtPrice = (p: number): string => (p >= 1000 ? p.toFixed(1) : p >= 1 ? p.toFixed(3) : p.toPrecision(4));

export function SignalCard({ plan, onView }: { plan: TradePlan; onView: (p: TradePlan) => void }) {
  const long = plan.direction === 'bullish';
  const pct = (x: number) => `${Math.round(x * 100)}`;
  return (
    <div
      data-testid="sig-card"
      className={`rounded border border-slate-800 bg-slate-900 p-2 text-xs ${plan.status === 'expired' ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center gap-2">
        <span className={long ? 'text-green-400' : 'text-red-400'}>{long ? '▲ LONG' : '▼ SHORT'}</span>
        <span className="text-lg font-semibold text-slate-100">{Math.round(plan.confidence.score)}</span>
        <span className="text-slate-400">{plan.setup.join(' + ')}</span>
        {plan.status === 'expired' && <span className="rounded bg-slate-700 px-1 text-[10px] text-slate-300">expired</span>}
        <span className="ml-auto text-slate-500">{plan.ageCandles}c ago</span>
      </div>
      <div className="mt-1 text-slate-300">
        entry {fmtPrice(plan.entry)} · stop {fmtPrice(plan.stop)} · target {fmtPrice(plan.target)} · R/R {plan.rr.toFixed(2)}
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
        <span>edge {pct(plan.confidence.edge)}</span>
        <span>sample {pct(plan.confidence.sample)}</span>
        <span>confl {pct(plan.confidence.confluence)}</span>
        <span>bracket {pct(plan.confidence.bracket)}</span>
        <button
          onClick={() => onView(plan)}
          className="ml-auto rounded bg-slate-800 px-2 py-0.5 text-slate-200 hover:bg-slate-700"
        >
          View on chart
        </button>
      </div>
    </div>
  );
}
