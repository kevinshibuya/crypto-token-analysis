import type { AnalysisConfig, AnalysisResponse, BacktestResponse, BacktestRunConfig, Interval, MarketsResponse, SignalsResult } from './types';
import type { SignalsSettings } from '../state/signalsSettings';

export async function getMarkets(): Promise<MarketsResponse> {
  const res = await fetch('/api/markets');
  if (!res.ok) throw new Error(`markets failed: ${res.status}`);
  return res.json();
}

export async function postAnalysis(cfg: AnalysisConfig, opts: { force?: boolean } = {}): Promise<AnalysisResponse> {
  const res = await fetch('/api/analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      coin: cfg.coin,
      interval: cfg.interval,
      lookback: cfg.lookback,
      force: opts.force ?? false,
      rsi: { period: cfg.rsiPeriod },
      movingAverages: cfg.movingAverages.map((m) => ({ type: m.type, period: m.period })),
      volumeProfile: { rows: cfg.volumeProfileRows },
      pivots: { lookback: cfg.pivotLookback, maxLevels: cfg.pivotMaxLevels },
    }),
  });
  if (!res.ok) throw new Error(`analysis failed: ${res.status}`);
  return res.json();
}

export async function postBacktest(
  coin: string,
  interval: Interval,
  cfg: BacktestRunConfig,
  signal?: AbortSignal,
): Promise<BacktestResponse> {
  const res = await fetch('/api/backtest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      coin, interval,
      lookback: cfg.lookback ?? 2000,
      config: {
        confluenceWindow: cfg.confluenceWindow,
        minRR: cfg.minRR,
        volumeSpikeK: cfg.volumeSpikeK,
        ...(cfg.signalKinds ? { signalKinds: cfg.signalKinds } : {}),
      },
    }),
  });
  if (!res.ok) throw new Error(`backtest failed: ${res.status}`);
  return res.json();
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function postSignals(
  coin: string,
  interval: Interval,
  s: SignalsSettings,
  opts: { force?: boolean; signal?: AbortSignal } = {},
): Promise<SignalsResult> {
  const res = await fetch('/api/signals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      coin, interval,
      config: {
        gate: s.gate, weights: s.weights, window: s.window,
        ...(opts.force ? { force: true } : {}),
      },
    }),
  });
  if (!res.ok) throw new ApiError(`signals failed: ${res.status}`, res.status);
  return res.json();
}
