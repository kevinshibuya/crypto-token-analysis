import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import {
  DEFAULT_BACKTEST_CONFIG, DEFAULT_GATE, DEFAULT_WEIGHTS, DEFAULT_WINDOW, SUPPORTED_INTERVALS,
} from '@cta/core';
import type { ConfidenceWeights, Interval, SetupGate } from '@cta/core';

export interface EngineConfig {
  universeCap: number;               // 0 = all listed coins
  timeframes: Interval[];            // must include '15m' (aggregation base)
  lookback: number;                  // candles of history per coin×timeframe
  confirmedMinConfidence: number;
  provisionalMinConfidence: number;
  tickMinMovePct: number;            // re-evaluate a coin only if mid moved this %
  tickMinIntervalMs: number;         // and at most once per this window
  workerCount: number;
  wsSilenceMs: number;               // no WS message for this long → reconnect
  wsDeadExitMs: number;              // WS down this long despite reconnects → watchdog exits
  closeGraceMs: number;              // close a forming candle this long after its boundary
  burstLimit: number;                // alerts per burstWindowMs before digesting
  burstWindowMs: number;
  dedupeCooldownMs: number;
  webOrigin: string;                 // deep-link base (Phase 4B serves the UI from the server origin)
  sinks: { telegram: boolean; discord: boolean; macos: boolean };
  analysis: {
    confluenceWindow: number; minRR: number; volumeSpikeK: number;
    gate: SetupGate; weights: ConfidenceWeights; window: number;
  };
  optimizer: {
    enabled: boolean;            // gates the nightly 00:10 UTC schedule only (manual trigger always works)
    minTrainTrades: number;
    minValidationTrades: number;
    validationFraction: number;
  };
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  universeCap: 0,
  timeframes: ['15m', '1h', '4h', '1d'],
  lookback: 2000,
  confirmedMinConfidence: 65,
  provisionalMinConfidence: 75,
  tickMinMovePct: 0.05,
  tickMinIntervalMs: 1000,
  workerCount: Math.max(1, cpus().length - 2),
  wsSilenceMs: 30_000,
  wsDeadExitMs: 300_000,
  closeGraceMs: 2_000,
  burstLimit: 10,
  burstWindowMs: 60_000,
  dedupeCooldownMs: 6 * 3_600_000,
  webOrigin: 'http://localhost:5173',
  sinks: { telegram: false, discord: false, macos: false },
  analysis: {
    confluenceWindow: DEFAULT_BACKTEST_CONFIG.confluenceWindow,
    minRR: DEFAULT_BACKTEST_CONFIG.minRR,
    volumeSpikeK: 2,
    gate: { ...DEFAULT_GATE },
    weights: { ...DEFAULT_WEIGHTS },
    window: DEFAULT_WINDOW,
  },
  optimizer: { enabled: true, minTrainTrades: 20, minValidationTrades: 8, validationFraction: 0.3 },
};

type Env = Record<string, string | undefined>;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isObject(patch)) return base;
  const out = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isObject(v) && isObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

export function loadEngineConfig(path = 'engine.json', env: Env = process.env): EngineConfig {
  let fileCfg: unknown = {};
  try {
    fileCfg = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // missing or unreadable file → defaults; malformed JSON also lands here deliberately (boot must not crash)
  }
  let cfg = deepMerge(structuredClone(DEFAULT_ENGINE_CONFIG), fileCfg);
  if (env.ENGINE_UNIVERSE_CAP) cfg = { ...cfg, universeCap: Number(env.ENGINE_UNIVERSE_CAP) };
  if (env.ENGINE_WORKERS) cfg = { ...cfg, workerCount: Number(env.ENGINE_WORKERS) };
  if (env.ENGINE_TIMEFRAMES) {
    const tfs = env.ENGINE_TIMEFRAMES.split(',').map((s) => s.trim()) as Interval[];
    const bad = tfs.filter((t) => !(SUPPORTED_INTERVALS as readonly string[]).includes(t));
    if (bad.length) throw new Error(`ENGINE_TIMEFRAMES: unknown intervals ${bad.join(', ')}`);
    cfg = { ...cfg, timeframes: tfs };
  }
  if (env.ENGINE_WEB_ORIGIN) cfg = { ...cfg, webOrigin: env.ENGINE_WEB_ORIGIN };
  // Sink rule: env secrets enable telegram/discord unless the json explicitly opts out (false).
  // macos needs no secret: the json toggle or ENGINE_MACOS_NOTIFY=1 enables it directly.
  const fileSinks = (isObject(fileCfg) && isObject((fileCfg as Record<string, unknown>).sinks)
    ? (fileCfg as { sinks: Record<string, unknown> }).sinks
    : {}) as Partial<Record<'telegram' | 'discord' | 'macos', boolean>>;
  cfg.sinks = {
    telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) && fileSinks.telegram !== false,
    discord: Boolean(env.DISCORD_WEBHOOK_URL) && fileSinks.discord !== false,
    macos: fileSinks.macos === true || env.ENGINE_MACOS_NOTIFY === '1',
  };
  if (!cfg.timeframes.includes('15m')) {
    throw new Error('engine timeframes must include 15m — it is the aggregation base');
  }
  return cfg;
}
