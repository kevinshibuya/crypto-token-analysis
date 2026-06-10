import { describe, it, expect } from 'vitest';
import { detectVolumeSpike } from '../src/signals/volumeSignals';
import { candle, ctxWith } from './fixtures';

describe('detectVolumeSpike', () => {
  it('tags spikes with the candle direction', () => {
    const candles = [
      candle(1, 10, 11, 9, 10.5, 10),  // v 10 vs sma 4*2=8 → up spike
      candle(2, 10, 11, 9, 9.5, 9),    // v 9 vs 8 → down spike
      candle(3, 10, 11, 9, 10.5, 7),   // 7 < 8 → none
    ];
    const ctx = ctxWith({ volumeSma: [4, 4, 4] });
    const s = detectVolumeSpike(candles, ctx);
    expect(s.map((x) => [x.kind, x.index])).toEqual([
      ['volume-spike-up', 0],
      ['volume-spike-down', 1],
    ]);
    expect(s[0].meta).toEqual({ ratio: 2.5 });
  });
  it('skips NaN sma warmup', () => {
    const ctx = ctxWith({ volumeSma: [NaN] });
    expect(detectVolumeSpike([candle(1, 10, 11, 9, 10.5, 100)], ctx)).toEqual([]);
  });
});
