import { join } from 'node:path';
import pino from 'pino';

export type EngineLogger = pino.Logger;

/** Structured engine log with size-capped rotation: data/logs/engine.log, 20MB × 5 files. */
export function createEngineLogger(dir = 'data/logs'): EngineLogger {
  const transport = pino.transport({
    target: 'pino-roll',
    options: { file: join(dir, 'engine.log'), size: '20m', limit: { count: 5 }, mkdir: true },
  });
  return pino({ level: process.env.LOG_LEVEL ?? 'info', base: undefined }, transport);
}

/** Silent logger for tests. */
export function nullLogger(): EngineLogger {
  return pino({ level: 'silent' });
}
