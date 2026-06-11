import type { EngineLogger } from '../logger';
import type { Sink } from './types';

export interface SinkDispatcherOptions {
  sinks: Sink[];
  log: EngineLogger;
  attempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Fan-out with per-sink retry; never throws; returns the sink names that accepted. */
export class SinkDispatcher {
  private attempts: number;
  private baseDelayMs: number;
  private sleep: (ms: number) => Promise<void>;
  constructor(private opts: SinkDispatcherOptions) {
    this.attempts = opts.attempts ?? 3;
    this.baseDelayMs = opts.baseDelayMs ?? 1_000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get sinkNames(): string[] { return this.opts.sinks.map((s) => s.name); }

  async dispatch(text: string): Promise<string[]> {
    const results = await Promise.all(this.opts.sinks.map(async (sink) => {
      for (let attempt = 0; attempt < this.attempts; attempt++) {
        try {
          await sink.send(text);
          return sink.name;
        } catch (err) {
          if (attempt < this.attempts - 1) {
            await this.sleep(this.baseDelayMs * 2 ** attempt);
          } else {
            this.opts.log.error({ sink: sink.name, err: (err as Error).message }, 'sink delivery failed after retries');
          }
        }
      }
      return null;
    }));
    return results.filter((r): r is string => r !== null);
  }
}
