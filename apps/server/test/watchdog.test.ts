import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { Watchdog } from '../src/engine/watchdog';
import { nullLogger } from '../src/engine/logger';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const capturingLogger = () => {
  const fatals: string[] = [];
  const log = pino({ base: undefined }, { write: (s: string) => {
    const rec = JSON.parse(s) as { level: number; msg: string };
    if (rec.level >= 60) fatals.push(rec.msg);
  } });
  return { log, fatals };
};

describe('Watchdog', () => {
  it('exits when the WS has been dead longer than wsDeadExitMs', async () => {
    let now = 0;
    const exits: number[] = [];
    const wd = new Watchdog({
      wsLastMessageAt: () => 0, wsDeadExitMs: 1_000, checkMs: 10, supervised: true,
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
      wsLastMessageAt: () => 0, wsDeadExitMs: 1_000, checkMs: 10, supervised: true,
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
      wsLastMessageAt: () => now, wsDeadExitMs: 1e9, checkMs: 10, supervised: true,
      stallToleranceMs: 1_000, log: nullLogger(), now: () => now, exit: (c) => { exits.push(c); },
    });
    wd.start();
    now = 50; await wait(30);   // normal drift, no exit
    expect(exits).toEqual([]);
    now += 5_000; await wait(30); // 5s jump between 10ms checks = stall signature
    expect(exits).toEqual([2]);
    wd.stop();
  });

  it('unsupervised (default): logs a stall but does not exit and keeps monitoring', async () => {
    let now = 0;
    const exits: number[] = [];
    const { log, fatals } = capturingLogger();
    const wd = new Watchdog({
      wsLastMessageAt: () => now, wsDeadExitMs: 1e9, checkMs: 10,
      stallToleranceMs: 1_000, log, now: () => now, exit: (c) => { exits.push(c); },
    });
    wd.start();
    now += 5_000; await wait(30); // freeze #1
    expect(exits).toEqual([]);
    expect(fatals.length).toBe(1);
    now += 50; await wait(30);    // healthy ticks in between
    now += 5_000; await wait(30); // freeze #2 still detected — watchdog kept running
    expect(exits).toEqual([]);
    expect(fatals.length).toBe(2);
    wd.stop();
  });

  it('unsupervised: logs WS death once per episode and does not exit', async () => {
    let now = 0;
    let lastMsg = 0;
    const exits: number[] = [];
    const { log, fatals } = capturingLogger();
    const wd = new Watchdog({
      wsLastMessageAt: () => lastMsg, wsDeadExitMs: 1_000, checkMs: 10,
      stallToleranceMs: 60_000, log, now: () => now, exit: (c) => { exits.push(c); },
    });
    wd.start();
    now = 1_500; await wait(50); // dead beyond limit across several checks
    expect(exits).toEqual([]);
    expect(fatals.length).toBe(1); // edge-logged once, not per check
    lastMsg = 1_600; now = 1_700; await wait(30); // WS recovered
    lastMsg = 1_700; now = 3_000; await wait(50); // dies again — new episode
    expect(exits).toEqual([]);
    expect(fatals.length).toBe(2);
    wd.stop();
  });

  it('unsupervised: a stall re-graces the WS check so a freeze does not double-fire ws-dead', async () => {
    let now = 0;
    const exits: number[] = [];
    const { log, fatals } = capturingLogger();
    const wd = new Watchdog({
      wsLastMessageAt: () => 0, wsDeadExitMs: 1_000, checkMs: 10,
      stallToleranceMs: 1_000, log, now: () => now, exit: (c) => { exits.push(c); },
    });
    wd.start();
    now += 5_000; await wait(30); // freeze past both stall tolerance AND wsDeadExitMs
    expect(exits).toEqual([]);
    expect(fatals.length).toBe(1); // stall only — WS gets a fresh grace window
    wd.stop();
  });
});
