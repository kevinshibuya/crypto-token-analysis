import { useSignals } from '../state/useSignals';
import { useSignalsSettings, DEFAULT_SIGNALS_SETTINGS, type SignalsSettings } from '../state/signalsSettings';
import { SignalCard } from './SignalCard';
import { ScannerPane } from './ScannerPane';
import type { Interval, Market, TradePlan } from '../api/types';

export interface SignalsPanelProps {
  coin: string;
  interval: Interval;
  markets: Market[];
  active: boolean;
  onCoin: (c: string) => void;
  onViewPlan: (p: TradePlan) => void;
}

function SettingsStrip({ s, onChange }: { s: SignalsSettings; onChange: (s: SignalsSettings) => void }) {
  const slider = (label: string, key: keyof SignalsSettings['weights']) => (
    <label className="flex items-center gap-1 text-xs text-slate-400">
      {label}
      <input
        data-testid={`sig-w-${key}`} type="range" min={0} max={100}
        value={Math.round(s.weights[key] * 100)}
        onChange={(e) => onChange({ ...s, weights: { ...s.weights, [key]: Number(e.target.value) / 100 } })}
        className="w-20"
      />
    </label>
  );
  const num = (testid: string, label: string, value: number, set: (n: number) => void, step = 1) => (
    <label className="flex items-center gap-1 text-xs text-slate-400">
      {label}
      <input
        data-testid={testid} type="number" step={step} value={value}
        onChange={(e) => { const n = Number(e.target.value); if (e.target.value !== '' && !Number.isNaN(n)) set(n); }}
        className="w-16 rounded bg-slate-800 px-1 py-0.5 text-right text-slate-200"
      />
    </label>
  );
  return (
    <div className="flex flex-wrap items-center gap-3 rounded border border-slate-800 bg-slate-900 p-2">
      {slider('edge', 'edge')}
      {slider('sample', 'sample')}
      {slider('confl', 'confluence')}
      {slider('bracket', 'bracket')}
      {num('sig-mintrades', 'min trades', s.gate.minTrades, (n) => onChange({ ...s, gate: { ...s.gate, minTrades: n } }))}
      {num('sig-minexp', 'min exp (R)', s.gate.minExpectancy, (n) => onChange({ ...s, gate: { ...s.gate, minExpectancy: n } }), 0.05)}
      {num('sig-topn', 'top N setups', s.gate.topN, (n) => onChange({ ...s, gate: { ...s.gate, topN: n } }))}
      {num('sig-window', 'window', s.window, (n) => onChange({ ...s, window: n }))}
      {num('sig-scantopn', 'scan coins', s.scanTopN, (n) => onChange({ ...s, scanTopN: n }))}
      <button
        data-testid="sig-reset"
        onClick={() => onChange(DEFAULT_SIGNALS_SETTINGS)}
        className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
      >
        Reset
      </button>
    </div>
  );
}

export function SignalsPanel({ coin, interval, markets, active, onCoin, onViewPlan }: SignalsPanelProps) {
  const [settings, setSettings] = useSignalsSettings();
  const { data, loading, error, reload } = useSignals(coin, interval, settings, active);

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3">
      <div className="flex w-[30rem] shrink-0 flex-col gap-2 overflow-auto">
        <SettingsStrip s={settings} onChange={setSettings} />
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>{coin} · {interval}</span>
          {loading && <span>loading…</span>}
          <button onClick={reload} className="ml-auto rounded bg-slate-800 px-2 py-0.5 text-slate-200 hover:bg-slate-700">↻ force</button>
        </div>
        {error && <div className="rounded bg-red-950 px-2 py-1 text-xs text-red-300">{error}</div>}
        {data && data.plans.length === 0 && !loading && (
          <p data-testid="sig-empty" className="text-xs text-slate-500">
            No signals in the last {settings.window} candles from {data.qualifiedCount} qualifying setup(s).
          </p>
        )}
        {data?.plans.map((p) => (
          <SignalCard key={p.setup.join('+') + p.direction} plan={p} onView={onViewPlan} />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-auto">
        <ScannerPane markets={markets} interval={interval} settings={settings} onCoin={onCoin} />
      </div>
    </div>
  );
}
