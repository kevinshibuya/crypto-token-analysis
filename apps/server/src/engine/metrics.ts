export interface Percentiles { p50: number; p95: number; count: number }

export interface HealthSnapshot {
  wsConnected: boolean;
  lastTickAgeMs: number;
  queueDepth: number;
  busyWorkers: number;
  coinsTracked: number;
  coinsLive: number;
  scansCompleted: number;
  latencies: Record<string, Percentiles>;
}

/** Fixed-capacity ring buffer of recent samples per metric name. */
export class LatencyTracker {
  private buffers = new Map<string, { samples: number[]; idx: number; full: boolean }>();
  constructor(private capacity = 512) {}

  record(name: string, ms: number): void {
    let b = this.buffers.get(name);
    if (!b) { b = { samples: new Array<number>(this.capacity), idx: 0, full: false }; this.buffers.set(name, b); }
    b.samples[b.idx] = ms;
    b.idx = (b.idx + 1) % this.capacity;
    if (b.idx === 0) b.full = true;
  }

  percentiles(name: string): Percentiles | null {
    const b = this.buffers.get(name);
    if (!b) return null;
    const live = b.full ? b.samples : b.samples.slice(0, b.idx);
    if (!live.length) return null;
    const sorted = [...live].sort((x, y) => x - y);
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return { p50: at(0.5), p95: at(0.95), count: sorted.length };
  }

  snapshot(): Record<string, Percentiles> {
    const out: Record<string, Percentiles> = {};
    for (const name of this.buffers.keys()) {
      const p = this.percentiles(name);
      if (p) out[name] = p;
    }
    return out;
  }
}
