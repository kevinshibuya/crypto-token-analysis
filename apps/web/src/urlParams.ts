import { SUPPORTED_INTERVALS } from './intervals';
import type { Interval } from './intervals';

export interface CoinInterval { coin: string; interval: Interval }

/** Deep-link support: ?coin=&interval= override the defaults; invalid values are ignored. */
export function applyUrlParams<T extends CoinInterval>(defaults: T, search: string): T {
  const params = new URLSearchParams(search);
  const coin = params.get('coin');
  const interval = params.get('interval');
  return {
    ...defaults,
    ...(coin ? { coin: coin.toUpperCase() } : {}),
    ...(interval && (SUPPORTED_INTERVALS as readonly string[]).includes(interval)
      ? { interval: interval as Interval } : {}),
  };
}
