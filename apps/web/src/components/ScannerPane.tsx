import { useMarketScan } from '../state/useMarketScan';
import type { Interval, Market } from '../api/types';
import type { SignalsSettings } from '../state/signalsSettings';

export function ScannerPane({ markets, interval, settings, onCoin }: {
  markets: Market[];
  interval: Interval;
  settings: SignalsSettings;
  onCoin: (c: string) => void;
}) {
  const { rows, done, total, scanning, start } = useMarketScan(markets, interval, settings);
  const ranked = rows
    .filter((r) => r.status === 'ok' && r.plan)
    .sort((a, b) => b.plan!.confidence.score - a.plan!.confidence.score);
  const skipped = rows.filter((r) => r.status !== 'ok');

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          data-testid="scan-start"
          onClick={start}
          disabled={scanning || markets.length === 0}
          className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Scan market
        </button>
        <span className="text-xs text-slate-400">top {settings.scanTopN} by 24h volume · {interval}</span>
        {total > 0 && <span data-testid="scan-progress" className="text-xs text-slate-400">{done}/{total}</span>}
      </div>
      <table className="w-full border-collapse text-xs text-slate-200">
        <thead>
          <tr className="border-b border-slate-700 text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="px-2 py-1">#</th><th className="px-2 py-1">coin</th><th className="px-2 py-1">dir</th>
            <th className="px-2 py-1 text-right">conf</th><th className="px-2 py-1">setup</th>
            <th className="px-2 py-1 text-right">R/R</th><th className="px-2 py-1 text-right">age</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((r, i) => (
            <tr
              key={r.coin} data-testid="scan-row" onClick={() => onCoin(r.coin)}
              className="cursor-pointer border-b border-slate-800 hover:bg-slate-800/60"
            >
              <td className="px-2 py-1">{i + 1}</td>
              <td className="px-2 py-1">{r.coin}</td>
              <td className={`px-2 py-1 ${r.plan!.direction === 'bullish' ? 'text-green-400' : 'text-red-400'}`}>
                {r.plan!.direction === 'bullish' ? '▲' : '▼'}
              </td>
              <td className="px-2 py-1 text-right font-semibold">{Math.round(r.plan!.confidence.score)}</td>
              <td className="px-2 py-1">{r.plan!.setup.join(' + ')}</td>
              <td className="px-2 py-1 text-right">{r.plan!.rr.toFixed(2)}</td>
              <td className="px-2 py-1 text-right">{r.plan!.ageCandles}c</td>
            </tr>
          ))}
          {skipped.map((r) => (
            <tr key={r.coin} data-testid="scan-skip" className="border-b border-slate-800 opacity-50">
              <td className="px-2 py-1" />
              <td className="px-2 py-1">{r.coin}</td>
              <td className="px-2 py-1" colSpan={5}>
                {r.status === 'thin'
                  ? 'insufficient data'
                  : <span className="rounded bg-red-950 px-1 text-red-300">{r.error}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!scanning && total > 0 && ranked.length === 0 && (
        <p className="text-xs text-slate-500">No active signals among the scanned coins.</p>
      )}
    </div>
  );
}
