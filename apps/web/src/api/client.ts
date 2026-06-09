import type { AnalysisConfig, AnalysisResponse, MarketsResponse } from './types';

export async function getMarkets(): Promise<MarketsResponse> {
  const res = await fetch('/api/markets');
  if (!res.ok) throw new Error(`markets failed: ${res.status}`);
  return res.json();
}

export async function postAnalysis(cfg: AnalysisConfig): Promise<AnalysisResponse> {
  const res = await fetch('/api/analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      coin: cfg.coin,
      interval: cfg.interval,
      lookback: cfg.lookback,
      rsi: { period: cfg.rsiPeriod },
      movingAverages: cfg.movingAverages.map((m) => ({ type: m.type, period: m.period })),
      volumeProfile: { rows: cfg.volumeProfileRows },
      pivots: { lookback: cfg.pivotLookback, maxLevels: cfg.pivotMaxLevels },
    }),
  });
  if (!res.ok) throw new Error(`analysis failed: ${res.status}`);
  return res.json();
}
