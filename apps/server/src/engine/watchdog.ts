import type { EngineLogger } from './logger';

export interface WatchdogOptions {
  wsLastMessageAt: () => number;
  wsDeadExitMs: number;
  checkMs?: number;          // default 10_000
  stallToleranceMs?: number; // default 30_000
  log: EngineLogger;
  now?: () => number;
  exit?: (code: number) => void;
}

/**
 * Deliberate-exit recovery: launchd KeepAlive restarts the process.
 * Exit 1 = WS dead beyond wsDeadExitMs measured from the later of the last WS message or watchdog
 * start time (the start-time baseline prevents spurious exits when no WS message has arrived yet
 * at cold boot). Exit 2 = event-loop stall (timer-skew signature).
 * Exit is one-shot: the watchdog stops itself after firing (matters when `exit` is injected and
 * does not actually terminate the process, e.g. in tests).
 */
export class Watchdog {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastCheck = 0;
  private startAt = 0;
  private checkMs: number;
  private stallToleranceMs: number;
  private now: () => number;
  private exit: (code: number) => void;

  constructor(private o: WatchdogOptions) {
    this.checkMs = o.checkMs ?? 10_000;
    this.stallToleranceMs = o.stallToleranceMs ?? 30_000;
    this.now = o.now ?? (() => Date.now());
    this.exit = o.exit ?? ((code) => process.exit(code));
  }

  start(): void {
    this.lastCheck = this.now();
    this.startAt = this.now();
    this.timer = setInterval(() => this.check(), this.checkMs);
    this.timer.unref?.();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private check(): void {
    const t = this.now();
    const gap = t - this.lastCheck;
    this.lastCheck = t;
    if (gap > this.checkMs + this.stallToleranceMs) {
      this.o.log.fatal({ gap }, 'watchdog: event loop stalled — exiting for launchd restart');
      this.stop();
      this.exit(2);
      return;
    }
    const lastSeen = Math.max(this.o.wsLastMessageAt(), this.startAt);
    if (t - lastSeen > this.o.wsDeadExitMs) {
      this.o.log.fatal({ deadMs: t - lastSeen }, 'watchdog: WS dead beyond limit — exiting for launchd restart');
      this.stop();
      this.exit(1);
    }
  }
}
