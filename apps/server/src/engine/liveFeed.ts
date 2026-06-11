// apps/server/src/engine/liveFeed.ts
import type { ServerResponse } from 'node:http';
import type { EngineLogger } from './logger';

export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export interface LiveFeedOptions {
  log: EngineLogger;
  /** per-client pending-frame cap; beyond it the OLDEST buffered frames are dropped */
  maxBuffered?: number;
  heartbeatMs?: number;
}

interface Client {
  id: number;
  res: ServerResponse;
  buffer: string[];
  blocked: boolean;
}

/**
 * SSE fan-out hub. A slow client never blocks the engine: writes that report
 * backpressure flip the client to buffered mode (drop-oldest beyond maxBuffered),
 * flushed on 'drain'. Headers are written by the route before addClient.
 */
export class LiveFeed {
  private clients = new Map<number, Client>();
  private nextId = 1;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private log: EngineLogger;
  private maxBuffered: number;
  private heartbeatMs: number;

  constructor(opts: LiveFeedOptions) {
    this.log = opts.log;
    this.maxBuffered = opts.maxBuffered ?? 256;
    this.heartbeatMs = opts.heartbeatMs ?? 15_000;
  }

  get clientCount(): number { return this.clients.size; }

  addClient(res: ServerResponse, snapshotFrames: string[]): number {
    const client: Client = { id: this.nextId++, res, buffer: [], blocked: false };
    this.clients.set(client.id, client);
    res.on('drain', () => this.flush(client));
    res.on('close', () => this.removeClient(client.id));
    res.on('error', () => this.removeClient(client.id));
    for (const f of snapshotFrames) this.send(client, f);
    if (!this.heartbeat) {
      this.heartbeat = setInterval(() => {
        for (const c of this.clients.values()) this.send(c, ': ping\n\n');
      }, this.heartbeatMs);
      this.heartbeat.unref?.();
    }
    this.log.info({ client: client.id, clients: this.clients.size }, 'live client connected');
    return client.id;
  }

  removeClient(id: number): void {
    if (!this.clients.delete(id)) return;
    this.log.info({ client: id, clients: this.clients.size }, 'live client disconnected');
    if (this.clients.size === 0 && this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  broadcast(event: string, data: unknown): void {
    if (this.clients.size === 0) return;
    const frame = sseFrame(event, data);
    for (const c of [...this.clients.values()]) this.send(c, frame);
  }

  destroy(): void {
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
    for (const c of [...this.clients.values()]) {
      try { c.res.end(); } catch { /* already gone */ }
    }
    this.clients.clear();
  }

  private send(c: Client, frame: string): void {
    if (c.blocked) {
      c.buffer.push(frame);
      if (c.buffer.length > this.maxBuffered) c.buffer.splice(0, c.buffer.length - this.maxBuffered);
      return;
    }
    try {
      if (!c.res.write(frame)) c.blocked = true;
    } catch {
      this.removeClient(c.id);
    }
  }

  private flush(c: Client): void {
    c.blocked = false;
    while (c.buffer.length > 0 && !c.blocked) {
      const frame = c.buffer.shift()!;
      try {
        if (!c.res.write(frame)) c.blocked = true;
      } catch {
        this.removeClient(c.id);
        return;
      }
    }
  }
}
