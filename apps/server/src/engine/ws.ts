import { EventEmitter } from 'node:events';
import type { Candle } from '@cta/core';
import type { EngineLogger } from './logger';

export interface HyperliquidWsOptions {
  url?: string;
  log: EngineLogger;
  silenceMs?: number;
  pingIntervalMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  now?: () => number;
}

export interface WsCandleEvent { coin: string; interval: string; candle: Candle }

/**
 * Single-connection Hyperliquid WS: allMids + candle@15m per coin.
 * Emits: 'candle' (WsCandleEvent), 'mids' (Record<string, number>), 'open', 'down' (reason string).
 * Reconnect/resubscribe is internal; REST gap-fill on 'open' after 'down' is the caller's job.
 */
export class HyperliquidWs extends EventEmitter {
  private url: string;
  private log: EngineLogger;
  private silenceMs: number;
  private pingIntervalMs: number;
  private baseBackoffMs: number;
  private maxBackoffMs: number;
  private now: () => number;

  private sock: WebSocket | null = null;
  private coins = new Set<string>();
  private stopped = true;
  private attempt = 0;
  private lastMsgAt = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: HyperliquidWsOptions) {
    super();
    this.url = opts.url ?? 'wss://api.hyperliquid.xyz/ws';
    this.log = opts.log;
    this.silenceMs = opts.silenceMs ?? 30_000;
    this.pingIntervalMs = opts.pingIntervalMs ?? 30_000;
    this.baseBackoffMs = opts.baseBackoffMs ?? 1_000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 60_000;
    this.now = opts.now ?? (() => Date.now());
  }

  get connected(): boolean { return this.sock?.readyState === WebSocket.OPEN; }
  get lastMessageAt(): number { return this.lastMsgAt; }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.sock?.close();
    this.sock = null;
  }

  /** Declarative subscription set; diffs against the current one on a live socket. */
  setCoins(coins: string[]): void {
    const next = new Set(coins);
    if (this.connected) {
      for (const c of next) if (!this.coins.has(c)) this.send({ method: 'subscribe', subscription: { type: 'candle', coin: c, interval: '15m' } });
      for (const c of this.coins) if (!next.has(c)) this.send({ method: 'unsubscribe', subscription: { type: 'candle', coin: c, interval: '15m' } });
    }
    this.coins = next;
  }

  private connect(): void {
    if (this.stopped) return;
    let sock: WebSocket;
    try {
      sock = new WebSocket(this.url);
    } catch (err) {
      this.scheduleReconnect(`constructor: ${String(err)}`);
      return;
    }
    this.sock = sock;
    sock.addEventListener('open', () => {
      if (sock !== this.sock) return; // a newer connection superseded this one
      this.attempt = 0;
      this.lastMsgAt = this.now();
      this.send({ method: 'subscribe', subscription: { type: 'allMids' } });
      for (const c of this.coins) this.send({ method: 'subscribe', subscription: { type: 'candle', coin: c, interval: '15m' } });
      this.armTimers();
      this.emit('open');
    });
    sock.addEventListener('message', (ev) => {
      if (sock !== this.sock) return;
      this.lastMsgAt = this.now();
      this.handle(typeof ev.data === 'string' ? ev.data : '');
    });
    const onGone = (reason: string) => () => {
      if (sock !== this.sock) return;
      this.sock = null;
      this.clearTimers();
      if (!this.stopped) {
        this.emit('down', reason);
        this.scheduleReconnect(reason);
      }
    };
    sock.addEventListener('close', onGone('close'));
    sock.addEventListener('error', onGone('error'));
  }

  private handle(raw: string): void {
    let msg: { channel?: string; data?: unknown };
    try { msg = JSON.parse(raw); } catch { this.log.warn({ raw: raw.slice(0, 200) }, 'ws: malformed message'); return; }
    if (msg.channel === 'candle') {
      const d = msg.data as { t: number; s: string; i: string; o: string; h: string; l: string; c: string; v: string; n: number };
      if (!d || typeof d.t !== 'number') { this.log.warn('ws: malformed candle'); return; }
      this.emit('candle', {
        coin: d.s, interval: d.i,
        candle: { t: d.t, o: +d.o, h: +d.h, l: +d.l, c: +d.c, v: +d.v, n: d.n },
      } satisfies WsCandleEvent);
    } else if (msg.channel === 'allMids') {
      const mids = (msg.data as { mids?: Record<string, string> })?.mids;
      if (!mids) return;
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(mids)) out[k] = +v;
      this.emit('mids', out);
    }
    // pong and subscription acks only refresh lastMsgAt
  }

  private armTimers(): void {
    this.clearTimers();
    this.timers.push(setInterval(() => this.send({ method: 'ping' }), this.pingIntervalMs));
    this.timers.push(setInterval(() => {
      if (this.now() - this.lastMsgAt > this.silenceMs) {
        this.log.warn({ silenceMs: this.silenceMs }, 'ws: silence threshold — forcing reconnect');
        const sock = this.sock;
        this.sock = null;
        this.clearTimers();
        sock?.close();
        this.emit('down', 'silence');
        this.scheduleReconnect('silence');
      }
    }, Math.max(10, Math.min(this.silenceMs / 4, 5_000))));
    for (const t of this.timers) if (typeof t === 'object' && 'unref' in t) t.unref();
  }

  private clearTimers(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private scheduleReconnect(reason: string): void {
    if (this.stopped) return;
    const delay = Math.min(this.maxBackoffMs, this.baseBackoffMs * 2 ** this.attempt++);
    this.log.info({ reason, delay, attempt: this.attempt }, 'ws: reconnect scheduled');
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
    this.reconnectTimer.unref?.();
  }

  private send(obj: unknown): void {
    if (this.connected) this.sock!.send(JSON.stringify(obj));
  }
}
