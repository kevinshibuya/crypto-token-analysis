import type { Candle, Signal, SignalKind } from './types';
import type { Detector, DetectorContext } from './detectorContext';
import { detectDoji, detectHammer, detectShootingStar } from './patterns/singleCandle';
import { detectEngulfing, detectHarami } from './patterns/twoCandle';
import { detectStars, detectSoldiersCrows } from './patterns/threeCandle';
import { detectRsiZoneExits, detectRsiDivergence } from './signals/rsiSignals';
import { detectMaCross, detectPriceMaCross } from './signals/maSignals';
import { detectVolumeSpike } from './signals/volumeSignals';
import { detectSrSignals } from './signals/srSignals';

const only = (kind: SignalKind, fn: Detector): Detector =>
  (candles, ctx) => fn(candles, ctx).filter((s) => s.kind === kind);

export const DETECTOR_REGISTRY: Record<SignalKind, Detector> = {
  'doji': detectDoji,
  'hammer': detectHammer,
  'shooting-star': detectShootingStar,
  'bullish-engulfing': only('bullish-engulfing', detectEngulfing),
  'bearish-engulfing': only('bearish-engulfing', detectEngulfing),
  'bullish-harami': only('bullish-harami', detectHarami),
  'bearish-harami': only('bearish-harami', detectHarami),
  'morning-star': only('morning-star', detectStars),
  'evening-star': only('evening-star', detectStars),
  'three-white-soldiers': only('three-white-soldiers', detectSoldiersCrows),
  'three-black-crows': only('three-black-crows', detectSoldiersCrows),
  'rsi-oversold-exit': only('rsi-oversold-exit', detectRsiZoneExits),
  'rsi-overbought-exit': only('rsi-overbought-exit', detectRsiZoneExits),
  'rsi-bullish-divergence': only('rsi-bullish-divergence', detectRsiDivergence),
  'rsi-bearish-divergence': only('rsi-bearish-divergence', detectRsiDivergence),
  'ma-golden-cross': only('ma-golden-cross', detectMaCross),
  'ma-death-cross': only('ma-death-cross', detectMaCross),
  'price-cross-ma-up': only('price-cross-ma-up', detectPriceMaCross),
  'price-cross-ma-down': only('price-cross-ma-down', detectPriceMaCross),
  'volume-spike-up': only('volume-spike-up', detectVolumeSpike),
  'volume-spike-down': only('volume-spike-down', detectVolumeSpike),
  'sr-bounce-support': only('sr-bounce-support', detectSrSignals),
  'sr-bounce-resistance': only('sr-bounce-resistance', detectSrSignals),
  'sr-break-up': only('sr-break-up', detectSrSignals),
  'sr-break-down': only('sr-break-down', detectSrSignals),
};

export const SIGNAL_KINDS = Object.keys(DETECTOR_REGISTRY) as SignalKind[];

export type SignalFamily = 'pattern' | 'rsi' | 'ma' | 'volume' | 'sr';

export function signalFamily(kind: SignalKind): SignalFamily {
  if (kind.startsWith('rsi-')) return 'rsi';
  if (kind.startsWith('ma-') || kind.startsWith('price-cross-ma')) return 'ma';
  if (kind.startsWith('volume-')) return 'volume';
  if (kind.startsWith('sr-')) return 'sr';
  return 'pattern';
}

// DETECTOR_REGISTRY is the source of truth for the kind->detector mapping; this is its
// unique base-function set (each SignalKind is emitted by exactly one). Keep in sync: the
// 'detectAll dedupe' test in test/detectors.test.ts fails if a drifted detector fires here.
const BASE_DETECTORS: Detector[] = [
  detectDoji, detectHammer, detectShootingStar,
  detectEngulfing, detectHarami,
  detectStars, detectSoldiersCrows,
  detectRsiZoneExits, detectRsiDivergence,
  detectMaCross, detectPriceMaCross,
  detectVolumeSpike, detectSrSignals,
];

export function detectAll(candles: Candle[], ctx: DetectorContext): Signal[] {
  const out: Signal[] = [];
  for (const detect of BASE_DETECTORS) out.push(...detect(candles, ctx));
  out.sort((a, b) => a.index - b.index || a.kind.localeCompare(b.kind));
  return out;
}
