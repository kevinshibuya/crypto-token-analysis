import type { Candle } from '../types';

export const DOJI_BODY_MAX_RATIO = 0.1;     // doji: body <= 10% of range
export const WICK_BODY_MULT = 2;            // hammer/star: dominant wick >= 2x body
export const SMALL_BODY_MAX_RATIO = 0.35;   // hammer/star: body <= 35% of range
export const STAR_MID_BODY_MAX_RATIO = 0.5; // star middle body <= 50% of first body
export const LONG_BODY_MIN_RATIO = 0.6;     // "long" candle: body >= 60% of range

export const body = (c: Candle): number => Math.abs(c.c - c.o);
export const range = (c: Candle): number => c.h - c.l;
export const upperWick = (c: Candle): number => c.h - Math.max(c.o, c.c);
export const lowerWick = (c: Candle): number => Math.min(c.o, c.c) - c.l;
export const isBull = (c: Candle): boolean => c.c > c.o;
export const isBear = (c: Candle): boolean => c.c < c.o;
export const isLongBody = (c: Candle): boolean => range(c) > 0 && body(c) >= LONG_BODY_MIN_RATIO * range(c);
