import { describe, expect, it } from 'vitest';
import { Watchdog } from '../src/engine/watchdog';
import { nullLogger } from '../src/engine/logger';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Watchdog', () => {
  it('exits when the WS has been dead longer than wsDeadExitMs', async () => {
    let now = 0;
    const exits: number[] = [];
    const wd = new Watchdog({
      wsLastMessageAt: () => 0, wsDeadExitMs: 1_000, checkMs: 10,
      stallToleranceMs: 60_000, log: nullLogger(), now: () => now, exit: (c) => { exits.push(c); },
    });
    wd.start();
    now = 500; await wait(30);
    expect(exits).toEqual([]);
    now = 1_500; await wait(30);
    expect(exits).toEqual([1]);
    wd.stop();
  });

  it('does not exit for a never-messaged WS until wsDeadExitMs has elapsed since start()', async () => {
    let now = 1_000_000; // wall clock ≫ wsDeadExitMs, lastMessageAt still 0
    const exits: number[] = [];
    const wd = new Watchdog({
      wsLastMessageAt: () => 0, wsDeadExitMs: 1_000, checkMs: 10,
      stallToleranceMs: 60_000, log: nullLogger(), now: () => now, exit: (c) => { exits.push(c); },
    });
    wd.start();
    now = 1_000_500; await wait(30); // 500ms since start — inside the grace
    expect(exits).toEqual([]);
    now = 1_001_500; await wait(30); // 1500ms since start — beyond wsDeadExitMs
    expect(exits).toEqual([1]);
    wd.stop();
  });

  it('exits when the event loop stalls past tolerance (simulated via clock jump)', async () => {
    let now = 0;
    const exits: number[] = [];
    const wd = new Watchdog({
      wsLastMessageAt: () => now, wsDeadExitMs: 1e9, checkMs: 10,
      stallToleranceMs: 1_000, log: nullLogger(), now: () => now, exit: (c) => { exits.push(c); },
    });
    wd.start();
    now = 50; await wait(30);   // normal drift, no exit
    expect(exits).toEqual([]);
    now += 5_000; await wait(30); // 5s jump between 10ms checks = stall signature
    expect(exits).toEqual([2]);
    wd.stop();
  });
});
