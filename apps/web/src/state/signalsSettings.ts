import { DEFAULT_GATE, DEFAULT_WEIGHTS, DEFAULT_WINDOW } from '@cta/core';
import type { ConfidenceWeights, SetupGate } from '@cta/core';

export interface SignalsSettings {
  weights: ConfidenceWeights;
  gate: SetupGate;
  window: number;
  scanTopN: number;
}

export const DEFAULT_SIGNALS_SETTINGS: SignalsSettings = {
  weights: DEFAULT_WEIGHTS,
  gate: DEFAULT_GATE,
  window: DEFAULT_WINDOW,
  scanTopN: 30,
};
