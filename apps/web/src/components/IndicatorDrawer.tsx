import type { AnalysisConfig, MaConfig } from '../api/types';

const MA_COLORS = ['#22d3ee', '#f59e0b', '#a78bfa', '#34d399', '#f472b6'];

export function IndicatorDrawer({
  config, onChange,
}: { config: AnalysisConfig; onChange: (c: AnalysisConfig) => void }) {
  const update = (patch: Partial<AnalysisConfig>) => onChange({ ...config, ...patch });
  const setMa = (idx: number, patch: Partial<MaConfig>) =>
    update({ movingAverages: config.movingAverages.map((m, i) => (i === idx ? { ...m, ...patch } : m)) });
  const addMa = () =>
    update({
      movingAverages: [
        ...config.movingAverages,
        { type: 'EMA', period: 50, color: MA_COLORS[config.movingAverages.length % MA_COLORS.length] },
      ],
    });
  const removeMa = (idx: number) =>
    update({ movingAverages: config.movingAverages.filter((_, i) => i !== idx) });

  const numberField = (label: string, value: number, onValue: (n: number) => void, min = 1, max?: number) => (
    <label className="flex items-center justify-between">
      {label}
      <input
        type="number" min={min} max={max} value={value}
        onChange={(e) => { const n = Number(e.target.value); if (e.target.value !== '' && !Number.isNaN(n)) onValue(n); }}
        className="w-16 rounded bg-slate-800 px-1 py-0.5 text-right"
      />
    </label>
  );

  return (
    <aside className="w-64 shrink-0 space-y-4 overflow-auto border-l border-slate-800 bg-slate-900 p-3 text-sm">
      <section>
        <h3 className="mb-1 text-xs uppercase tracking-wide text-slate-500">RSI</h3>
        {numberField('Period', config.rsiPeriod, (n) => update({ rsiPeriod: n }))}
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-wide text-slate-500">Moving averages</h3>
          <button onClick={addMa} className="text-xs text-blue-400">+ add</button>
        </div>
        <div className="space-y-2">
          {config.movingAverages.map((m, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="h-3 w-3 rounded" style={{ background: m.color }} />
              <select
                value={m.type} onChange={(e) => setMa(i, { type: e.target.value as MaConfig['type'] })}
                className="rounded bg-slate-800 px-1 py-0.5"
              >
                <option>SMA</option>
                <option>EMA</option>
              </select>
              <input
                type="number" min={1} value={m.period}
                onChange={(e) => { const n = Number(e.target.value); if (e.target.value !== '' && !Number.isNaN(n)) setMa(i, { period: n }); }}
                className="w-14 rounded bg-slate-800 px-1 py-0.5 text-right"
              />
              <button onClick={() => removeMa(i)} className="ml-auto text-xs text-slate-500 hover:text-red-400">✕</button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-xs uppercase tracking-wide text-slate-500">Volume profile</h3>
        {numberField('Rows', config.volumeProfileRows, (n) => update({ volumeProfileRows: n }), 1, 200)}
      </section>

      <section>
        <h3 className="mb-1 text-xs uppercase tracking-wide text-slate-500">S/R pivots</h3>
        {numberField('Lookback', config.pivotLookback, (n) => update({ pivotLookback: n }))}
        {numberField('Max levels', config.pivotMaxLevels, (n) => update({ pivotMaxLevels: n }))}
      </section>
    </aside>
  );
}
