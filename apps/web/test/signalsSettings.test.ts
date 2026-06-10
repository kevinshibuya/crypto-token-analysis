import { describe, it, expect, beforeEach } from 'vitest';
import { loadSettings, saveSettings, DEFAULT_SIGNALS_SETTINGS } from '../src/state/signalsSettings';

beforeEach(() => localStorage.clear());

describe('signals settings persistence', () => {
  it('round-trips through localStorage', () => {
    const custom = { ...DEFAULT_SIGNALS_SETTINGS, window: 7, scanTopN: 12 };
    saveSettings(custom);
    expect(loadSettings()).toEqual(custom);
  });

  it('returns defaults when nothing stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SIGNALS_SETTINGS);
  });

  it('survives corrupt JSON and partial objects', () => {
    localStorage.setItem('cta:signals-settings:v1', '{nope');
    expect(loadSettings()).toEqual(DEFAULT_SIGNALS_SETTINGS);
    localStorage.setItem('cta:signals-settings:v1', JSON.stringify({ window: 9 }));
    expect(loadSettings()).toEqual({ ...DEFAULT_SIGNALS_SETTINGS, window: 9 });
  });
});
