import { signalFamily } from '@cta/core';
import type { Signal, SignalFamily, SignalKind } from './api/types';

export const SIGNAL_LABELS: Record<SignalKind, string> = {
  'bullish-engulfing': 'ENG', 'bearish-engulfing': 'ENG',
  'hammer': 'HAM', 'shooting-star': 'STAR', 'doji': 'DOJI',
  'morning-star': 'MSTR', 'evening-star': 'ESTR',
  'three-white-soldiers': '3WS', 'three-black-crows': '3BC',
  'bullish-harami': 'HARA', 'bearish-harami': 'HARA',
  'rsi-oversold-exit': 'RSI', 'rsi-overbought-exit': 'RSI',
  'rsi-bullish-divergence': 'DIV', 'rsi-bearish-divergence': 'DIV',
  'ma-golden-cross': 'GX', 'ma-death-cross': 'DX',
  'price-cross-ma-up': 'PMA', 'price-cross-ma-down': 'PMA',
  'volume-spike-up': 'VOL', 'volume-spike-down': 'VOL',
  'sr-bounce-support': 'BNC', 'sr-bounce-resistance': 'BNC',
  'sr-break-up': 'BRK', 'sr-break-down': 'BRK',
};

export const FAMILY_LABELS: Record<SignalFamily, string> = {
  pattern: 'Candle patterns', rsi: 'RSI', ma: 'Moving averages', volume: 'Volume', sr: 'Support/Resistance',
};

export type FamilyToggles = Record<SignalFamily, boolean>;
export const DEFAULT_FAMILIES: FamilyToggles = { pattern: true, rsi: true, ma: true, volume: true, sr: true };

export interface ChartMarker {
  time: number;
  position: 'belowBar' | 'aboveBar';
  shape: 'arrowUp' | 'arrowDown';
  color: string;
  text: string;
}

export function buildMarkers(signals: Signal[], families: FamilyToggles): ChartMarker[] {
  return signals
    .filter((s) => families[signalFamily(s.kind)])
    .map((s) => ({
      time: Math.floor(s.t / 1000),
      position: s.direction === 'bullish' ? ('belowBar' as const) : ('aboveBar' as const),
      shape: s.direction === 'bullish' ? ('arrowUp' as const) : ('arrowDown' as const),
      color: s.direction === 'bullish' ? '#22c55e' : '#ef4444',
      text: SIGNAL_LABELS[s.kind],
    }))
    .sort((a, b) => a.time - b.time);
}
