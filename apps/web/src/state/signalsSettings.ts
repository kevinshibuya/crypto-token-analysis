import { useCallback, useState } from 'react';
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

const KEY = 'cta:signals-settings:v1';

export function loadSettings(): SignalsSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SIGNALS_SETTINGS;
    const p = JSON.parse(raw) as Partial<SignalsSettings>;
    return {
      weights: { ...DEFAULT_SIGNALS_SETTINGS.weights, ...p.weights },
      gate: { ...DEFAULT_SIGNALS_SETTINGS.gate, ...p.gate },
      window: p.window ?? DEFAULT_SIGNALS_SETTINGS.window,
      scanTopN: p.scanTopN ?? DEFAULT_SIGNALS_SETTINGS.scanTopN,
    };
  } catch {
    return DEFAULT_SIGNALS_SETTINGS;
  }
}

export function saveSettings(s: SignalsSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* quota: settings just don't persist */ }
}

export function useSignalsSettings(): [SignalsSettings, (s: SignalsSettings) => void] {
  const [settings, set] = useState<SignalsSettings>(loadSettings);
  const update = useCallback((s: SignalsSettings) => { set(s); saveSettings(s); }, []);
  return [settings, update];
}
