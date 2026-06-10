import type { Candle, Signal, SignalDirection } from '../types';
import { computeBracket, BRACKET_PAD_ATR, type BracketConfig } from './bracket';

export interface SimConfig extends BracketConfig {
  breakevenAtR: number; // move stop to entry once this many R in profit
}

export type ExitReason = 'target' | 'stop' | 'opposite-signal' | 'end-of-data';

export interface TradeRecord {
  direction: SignalDirection;
  entryIndex: number;
  entryPrice: number;
  exitIndex: number;
  exitPrice: number;
  r: number;
  reason: ExitReason;
}

export interface SimResult { trades: TradeRecord[]; filtered: number }

export function simulate(
  candles: Candle[],
  entries: Signal[],
  setupSignals: Signal[],
  pivotPricesAt: (i: number) => number[],
  atrByIndex: number[],
  cfg: SimConfig,
): SimResult {
  const trades: TradeRecord[] = [];
  let filtered = 0;

  const oppositeAt = new Map<number, Set<SignalDirection>>();
  for (const s of setupSignals) {
    const set = oppositeAt.get(s.index) ?? new Set<SignalDirection>();
    set.add(s.direction);
    oppositeAt.set(s.index, set);
  }

  let lastExitIndex = -1;
  for (const e of [...entries].sort((a, b) => a.index - b.index)) {
    const entryIndex = e.index + 1;
    if (entryIndex >= candles.length || entryIndex <= lastExitIndex) continue;
    const atrVal = atrByIndex[e.index];
    if (!Number.isFinite(atrVal) || atrVal <= 0) { filtered++; continue; }
    const entryPrice = candles[entryIndex].o;
    const bracket = computeBracket(entryPrice, e.direction, pivotPricesAt(e.index), atrVal, cfg);
    if (!bracket) { filtered++; continue; }

    const long = e.direction === 'bullish';
    const risk = Math.abs(entryPrice - bracket.stop);
    const target = bracket.target;
    let stop = bracket.stop;
    let pendingOpposite = false;
    let exit: { index: number; price: number; reason: ExitReason } | null = null;

    for (let j = entryIndex; j < candles.length && !exit; j++) {
      const c = candles[j];
      if (pendingOpposite) { exit = { index: j, price: c.o, reason: 'opposite-signal' }; break; }
      if (long ? c.l <= stop : c.h >= stop) { exit = { index: j, price: stop, reason: 'stop' }; break; }
      if (long ? c.h >= target : c.l <= target) { exit = { index: j, price: target, reason: 'target' }; break; }

      // close-of-candle updates — take effect from the next candle
      const opp = oppositeAt.get(j);
      if (opp?.has(long ? 'bearish' : 'bullish')) pendingOpposite = true;
      for (const P of pivotPricesAt(j)) {
        if (long && P > entryPrice && c.c > P) stop = Math.max(stop, P - BRACKET_PAD_ATR * atrVal);
        if (!long && P < entryPrice && c.c < P) stop = Math.min(stop, P + BRACKET_PAD_ATR * atrVal);
      }
      if (long ? c.h >= entryPrice + cfg.breakevenAtR * risk : c.l <= entryPrice - cfg.breakevenAtR * risk) {
        stop = long ? Math.max(stop, entryPrice) : Math.min(stop, entryPrice);
      }
    }

    if (!exit) {
      const last = candles.length - 1;
      exit = { index: last, price: candles[last].c, reason: 'end-of-data' };
    }
    const r = long ? (exit.price - entryPrice) / risk : (entryPrice - exit.price) / risk;
    trades.push({
      direction: e.direction, entryIndex, entryPrice,
      exitIndex: exit.index, exitPrice: exit.price, r, reason: exit.reason,
    });
    lastExitIndex = exit.index;
  }

  return { trades, filtered };
}
