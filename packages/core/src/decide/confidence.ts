import { CONFLUENCE_SAT, EDGE_SCALE, RR_SAT, SAMPLE_HALF } from './constants';
import type { ConfidenceBreakdown, ConfidenceWeights } from './types';

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export function scoreConfidence(
  expectancy: number,
  trades: number,
  agreeing: number,
  rr: number,
  w: ConfidenceWeights,
): ConfidenceBreakdown {
  const edge = clamp01(expectancy / EDGE_SCALE);
  const sample = trades / (trades + SAMPLE_HALF);
  const confluence = clamp01(agreeing / CONFLUENCE_SAT);
  const bracket = clamp01(rr / RR_SAT);
  const sum = w.edge + w.sample + w.confluence + w.bracket;
  const score = sum > 0
    ? (100 * (w.edge * edge + w.sample * sample + w.confluence * confluence + w.bracket * bracket)) / sum
    : 0;
  return { edge, sample, confluence, bracket, score };
}
