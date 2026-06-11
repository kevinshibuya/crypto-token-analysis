import type { AlertKind, LiveAlert } from '../api/types';

const BADGE: Record<AlertKind, string> = {
  'provisional-new': '⚠',
  'provisional-confirmed': '✓',
  'provisional-withdrawn': '✗',
  'confirmed-new': '🔔',
  digest: '📦', // digests are filtered out upstream; kept for type-exhaustiveness
};

export function AlertFeedPane({ alerts, onOpen }: {
  alerts: LiveAlert[];
  onOpen: (a: LiveAlert) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3">
      {alerts.length === 0 && <p className="text-xs text-slate-500">No alerts yet — they appear here as the engine fires them.</p>}
      {alerts.map((a) => {
        const p = a.payload;
        return (
          <button
            key={`${p.identity}|${a.kind}|${a.ts}`}
            data-testid="alert-row"
            onClick={() => onOpen(a)}
            className="flex items-center gap-3 rounded border border-slate-800 bg-slate-900 px-3 py-2 text-left text-xs text-slate-200 hover:bg-slate-800/70"
          >
            <span className="w-5 text-base">{BADGE[a.kind]}</span>
            <span className="w-32 text-slate-400">{new Date(a.ts).toLocaleString()}</span>
            <span className="w-16 font-semibold">{a.coin}</span>
            <span className="w-10 text-slate-400">{a.interval}</span>
            <span className={`w-5 ${p.direction === 'bullish' ? 'text-green-400' : 'text-red-400'}`}>
              {p.direction === 'bullish' ? '▲' : '▼'}
            </span>
            <span className="min-w-0 flex-1 truncate">{p.setup.join(' + ')}</span>
            <span className="w-14 text-right font-semibold">{Math.round(p.confidence)}</span>
            <span className="w-44 text-right text-slate-400">
              e {p.entry} · s {p.stop} · t {p.target}
            </span>
            {p.note && <span className="w-48 truncate text-slate-500" title={p.note}>{p.note}</span>}
          </button>
        );
      })}
    </div>
  );
}
