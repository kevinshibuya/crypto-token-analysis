import type { SignalDirection } from '../types';

export interface BracketConfig {
  atrFloorMult: number; // min stop/target distance in ATRs
  atrCapMult: number;   // max stop/target distance in ATRs
  minRR: number;        // trades below this R/R are skipped
}

export const BRACKET_PAD_ATR = 0.1;        // stop sits this many ATRs beyond the level
export const FALLBACK_STOP_ATR = 1.5;      // no structure: stop distance in ATRs
export const FALLBACK_TARGET_STOP_MULT = 2; // no structure: target = 2x stop distance

export interface Bracket { stop: number; target: number; rr: number }

export function computeBracket(
  entry: number,
  direction: SignalDirection,
  pivotPrices: number[],
  atrVal: number,
  cfg: BracketConfig,
): Bracket | null {
  const below = pivotPrices.filter((p) => p < entry).sort((a, b) => b - a)[0];
  const above = pivotPrices.filter((p) => p > entry).sort((a, b) => a - b)[0];
  const floor = cfg.atrFloorMult * atrVal;
  const cap = cfg.atrCapMult * atrVal;
  const clamp = (d: number) => Math.min(cap, Math.max(floor, d));

  let stopDist: number;
  let targetDist: number;
  if (direction === 'bullish') {
    stopDist = below !== undefined ? clamp(entry - (below - BRACKET_PAD_ATR * atrVal)) : FALLBACK_STOP_ATR * atrVal;
    targetDist = above !== undefined ? clamp(above - entry) : FALLBACK_TARGET_STOP_MULT * stopDist;
  } else {
    stopDist = above !== undefined ? clamp(above + BRACKET_PAD_ATR * atrVal - entry) : FALLBACK_STOP_ATR * atrVal;
    targetDist = below !== undefined ? clamp(entry - below) : FALLBACK_TARGET_STOP_MULT * stopDist;
  }

  const rr = targetDist / stopDist;
  if (rr < cfg.minRR) return null;
  return direction === 'bullish'
    ? { stop: entry - stopDist, target: entry + targetDist, rr }
    : { stop: entry + stopDist, target: entry - targetDist, rr };
}
