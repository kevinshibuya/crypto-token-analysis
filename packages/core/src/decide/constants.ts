import type { ConfidenceWeights, SetupGate } from './types';

export const EDGE_SCALE = 0.5;     // expectancy (R) at which edge component saturates
export const SAMPLE_HALF = 30;     // trades at which sample component reaches 0.5
export const CONFLUENCE_SAT = 3;   // agreeing setups at which confluence saturates
export const RR_SAT = 3;           // live R/R at which bracket component saturates

export const DEFAULT_GATE: SetupGate = { minTrades: 20, minExpectancy: 0.1, topN: 10 };
export const DEFAULT_WEIGHTS: ConfidenceWeights = { edge: 0.4, sample: 0.2, confluence: 0.2, bracket: 0.2 };
export const DEFAULT_WINDOW = 3;
