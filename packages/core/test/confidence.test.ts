import { describe, it, expect } from 'vitest';
import { scoreConfidence } from '../src/decide/confidence';
import { DEFAULT_WEIGHTS } from '../src/decide/constants';

describe('scoreConfidence', () => {
  it('computes the spec component formulas', () => {
    // edge: 0.25/0.5 = 0.5; sample: 30/(30+30) = 0.5; confluence: 1/3; bracket: 1.5/3 = 0.5
    const b = scoreConfidence(0.25, 30, 1, 1.5, DEFAULT_WEIGHTS);
    expect(b.edge).toBeCloseTo(0.5, 10);
    expect(b.sample).toBeCloseTo(0.5, 10);
    expect(b.confluence).toBeCloseTo(1 / 3, 10);
    expect(b.bracket).toBeCloseTo(0.5, 10);
    // score = 100 * (.4*.5 + .2*.5 + .2*(1/3) + .2*.5) / 1
    expect(b.score).toBeCloseTo(100 * (0.2 + 0.1 + 0.2 / 3 + 0.1), 8);
  });

  it('clamps saturated components to 1', () => {
    const b = scoreConfidence(2, 600, 9, 10, DEFAULT_WEIGHTS);
    expect(b.edge).toBe(1);
    expect(b.confluence).toBe(1);
    expect(b.bracket).toBe(1);
    expect(b.sample).toBeCloseTo(600 / 630, 10);
  });

  it('is invariant to scaling all weights by a constant', () => {
    const a = scoreConfidence(0.3, 40, 2, 2, DEFAULT_WEIGHTS);
    const w7 = { edge: 0.4 * 7, sample: 0.2 * 7, confluence: 0.2 * 7, bracket: 0.2 * 7 };
    expect(scoreConfidence(0.3, 40, 2, 2, w7).score).toBeCloseTo(a.score, 10);
  });

  it('returns score 0 when all weights are 0 and clamps negative expectancy', () => {
    const b = scoreConfidence(-1, 40, 2, 2, { edge: 0, sample: 0, confluence: 0, bracket: 0 });
    expect(b.score).toBe(0);
    expect(b.edge).toBe(0);
  });
});
