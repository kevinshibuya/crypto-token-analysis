import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG, loadEngineConfig } from '../src/engine/config';

describe('loadEngineConfig', () => {
  it('returns defaults when no file exists', () => {
    const cfg = loadEngineConfig(join(tmpdir(), 'nope', 'missing-engine.json'), {});
    expect(cfg).toEqual(DEFAULT_ENGINE_CONFIG);
    expect(cfg.timeframes).toEqual(['15m', '1h', '4h', '1d']);
    expect(cfg.confirmedMinConfidence).toBe(65);
    expect(cfg.provisionalMinConfidence).toBe(75);
  });

  it('deep-merges engine.json over defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'engcfg-'));
    const p = join(dir, 'engine.json');
    writeFileSync(p, JSON.stringify({ universeCap: 50, analysis: { minRR: 2 } }));
    const cfg = loadEngineConfig(p, {});
    expect(cfg.universeCap).toBe(50);
    expect(cfg.analysis.minRR).toBe(2);
    expect(cfg.analysis.gate.minTrades).toBe(DEFAULT_ENGINE_CONFIG.analysis.gate.minTrades); // untouched sibling
  });

  it('applies env overrides and derives sink enablement from secrets', () => {
    const cfg = loadEngineConfig(join(tmpdir(), 'missing.json'), {
      ENGINE_UNIVERSE_CAP: '20',
      ENGINE_TIMEFRAMES: '15m,1h',
      ENGINE_WORKERS: '2',
      TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'c',
    });
    expect(cfg.universeCap).toBe(20);
    expect(cfg.timeframes).toEqual(['15m', '1h']);
    expect(cfg.workerCount).toBe(2);
    expect(cfg.sinks.telegram).toBe(true);
    expect(cfg.sinks.discord).toBe(false); // no DISCORD_WEBHOOK_URL
  });

  it('rejects timeframes that do not include 15m (the aggregation base)', () => {
    expect(() => loadEngineConfig(join(tmpdir(), 'missing.json'), { ENGINE_TIMEFRAMES: '1h,4h' }))
      .toThrow(/15m/);
  });
});

describe('optimizer config', () => {
  it('defaults to enabled with spec gates', () => {
    const cfg = loadEngineConfig('/nonexistent/engine.json', {});
    expect(cfg.optimizer).toEqual({
      enabled: true, minTrainTrades: 20, minValidationTrades: 8, validationFraction: 0.3,
    });
  });

  it('deep-merges optimizer overrides from engine.json', () => {
    const path = join(tmpdir(), `engine-opt-${Date.now()}.json`);
    writeFileSync(path, JSON.stringify({ optimizer: { enabled: false, minTrainTrades: 5 } }));
    const cfg = loadEngineConfig(path, {});
    expect(cfg.optimizer.enabled).toBe(false);
    expect(cfg.optimizer.minTrainTrades).toBe(5);
    expect(cfg.optimizer.minValidationTrades).toBe(8); // untouched default survives
  });
});
