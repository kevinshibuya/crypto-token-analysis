import type { Candle } from '../src/types';
import { DEFAULT_DETECTOR_OPTIONS, type DetectorContext, type DetectorOptions } from '../src/detectorContext';

export const candle = (t: number, o: number, h: number, l: number, c: number, v = 1): Candle =>
  ({ t, o, h, l, c, v });

/** Hand-built context: detectors read indicator values from here, so tests
 *  control them directly instead of reverse-engineering real RSI/MA inputs. */
export function ctxWith(
  partial: Partial<DetectorContext> = {},
  opts: Partial<DetectorOptions> = {},
): DetectorContext {
  return {
    rsi: [], maFast: [], maSlow: [], volumeSma: [], atr: [], pivots: [],
    ...partial,
    opts: { ...DEFAULT_DETECTOR_OPTIONS, ...opts },
  };
}
