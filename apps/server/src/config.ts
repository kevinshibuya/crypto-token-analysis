export const HYPERLIQUID_BASE_URL = process.env.HL_BASE_URL ?? 'https://api.hyperliquid.xyz';
export const RATE_LIMIT_CAPACITY = 1200; // IP weight budget per minute
export const RATE_LIMIT_REFILL_PER_SEC = 1200 / 60;
export const MAX_CANDLES_PER_REQUEST = 5000;
export const DEFAULT_LOOKBACK = 1000;
export const CACHE_DB_PATH = process.env.CACHE_DB_PATH ?? 'data/cache.sqlite';

export { SUPPORTED_INTERVALS } from '@cta/core';
export type { Interval } from '@cta/core';

export const DEFAULTS = {
  rsiPeriod: 14,
  volumeSmaPeriod: 20,
  volumeProfileRows: 24,
  pivotLookback: 5,
  pivotMergeTolerance: 0.003,
  pivotMaxLevels: 6,
};

export const MIN_BACKTEST_CANDLES = 50;
export const BACKTEST_DEFAULT_LOOKBACK = 2000;
export const ROUTE_TIMEOUT_MS = Number(process.env.ROUTE_TIMEOUT_MS ?? 15_000);
