import type { Candle, Signal, SignalKind } from '../types';
import type { DetectorContext } from '../detectorContext';

export function detectSrSignals(candles: Candle[], ctx: DetectorContext): Signal[] {
  const out: Signal[] = [];
  for (let i = 1; i < candles.length; i++) {
    const tol = ctx.opts.srTolAtrMult * ctx.atr[i];
    if (!Number.isFinite(tol)) continue;
    const levels = ctx.pivotPricesAt(i);
    const prev = candles[i - 1];
    const c = candles[i];
    const seen = new Set<SignalKind>();
    const push = (kind: SignalKind, direction: 'bullish' | 'bearish', P: number) => {
      if (seen.has(kind)) return;
      seen.add(kind);
      out.push({ kind, direction, index: i, t: c.t, meta: { level: P } });
    };
    for (const P of levels) {
      if (prev.c > P && c.l <= P + tol && c.c > P + tol) push('sr-bounce-support', 'bullish', P);
      else if (prev.c < P && c.h >= P - tol && c.c < P - tol) push('sr-bounce-resistance', 'bearish', P);
      else if (prev.c <= P && c.c > P + tol) push('sr-break-up', 'bullish', P);
      else if (prev.c >= P && c.c < P - tol) push('sr-break-down', 'bearish', P);
    }
  }
  return out;
}
