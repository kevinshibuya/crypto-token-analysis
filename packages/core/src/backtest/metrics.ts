import type { TradeRecord } from './simulate';

export interface SetupMetrics {
  trades: number;
  wins: number;
  winRate: number;
  avgR: number;
  profitFactor: number | null; // null = wins but zero losses ("infinite")
  expectancy: number;          // equals avgR in R units; kept as an explicit column
  maxDrawdownR: number;
  filtered: number;            // entries skipped by the min-R/R or missing-ATR filter
  longTrades: number;
  shortTrades: number;
}

export function computeMetrics(trades: TradeRecord[], filtered: number): SetupMetrics {
  const n = trades.length;
  const rs = trades.map((t) => t.r);
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = -losses.reduce((a, b) => a + b, 0);
  const avgR = n ? rs.reduce((a, b) => a + b, 0) / n : 0;
  const winRate = n ? wins.length / n : 0;
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;

  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const r of rs) {
    equity += r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }

  return {
    trades: n,
    wins: wins.length,
    winRate,
    avgR,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? null : 0),
    expectancy: winRate * avgWin - (1 - winRate) * avgLoss,
    maxDrawdownR: maxDd,
    filtered,
    longTrades: trades.filter((t) => t.direction === 'bullish').length,
    shortTrades: trades.filter((t) => t.direction === 'bearish').length,
  };
}
