export const HYPERLIQUID_BASE_URL = process.env.HL_BASE_URL ?? 'https://api.hyperliquid.xyz';
export const RATE_LIMIT_CAPACITY = 1200; // IP weight budget per minute
export const RATE_LIMIT_REFILL_PER_SEC = 1200 / 60;
export const MAX_CANDLES_PER_REQUEST = 5000;
export const DEFAULT_LOOKBACK = 1000;
export const CACHE_DB_PATH = process.env.CACHE_DB_PATH ?? 'data/cache.sqlite';

export const SUPPORTED_INTERVALS = [
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '3d', '1w', '1M',
] as const;
export type Interval = (typeof SUPPORTED_INTERVALS)[number];

export const DEFAULTS = {
  rsiPeriod: 14,
  volumeSmaPeriod: 20,
  volumeProfileRows: 24,
  pivotLookback: 5,
  pivotMergeTolerance: 0.003,
  pivotMaxLevels: 6,
};
