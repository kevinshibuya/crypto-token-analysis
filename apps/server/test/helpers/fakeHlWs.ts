import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';

export interface FakeHlWs {
  url: string;
  /** all parsed messages received from the client, in order */
  received: unknown[];
  /** resolves when the next client connects */
  nextConnection(): Promise<ServerSocket>;
  send(obj: unknown): void;            // to the most recent client
  sendCandle(coin: string, candle: { t: number; o: number; h: number; l: number; c: number; v: number; n?: number }): void;
  sendMids(mids: Record<string, number>): void;
  dropClients(): void;                 // hard-close all sockets (simulates network drop)
  close(): Promise<void>;
}

export function startFakeHlWs(): Promise<FakeHlWs> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => {
      const { port } = wss.address() as { port: number };
      resolve(api(wss, `ws://127.0.0.1:${port}`));
    });
  });
}

function api(wss: WebSocketServer, url: string): FakeHlWs {
  const received: unknown[] = [];
  let sockets: ServerSocket[] = [];
  let waiters: ((s: ServerSocket) => void)[] = [];
  wss.on('connection', (sock) => {
    sockets.push(sock);
    sock.on('message', (buf) => {
      const msg = JSON.parse(buf.toString());
      received.push(msg);
      if (msg.method === 'ping') sock.send(JSON.stringify({ channel: 'pong' }));
    });
    waiters.splice(0).forEach((w) => w(sock));
  });
  const last = () => sockets[sockets.length - 1];
  return {
    url, received,
    nextConnection: () => new Promise((r) => waiters.push(r)),
    send: (obj) => last()?.send(JSON.stringify(obj)),
    sendCandle: (coin, c) => last()?.send(JSON.stringify({
      channel: 'candle',
      data: { t: c.t, T: c.t + 899_999, s: coin, i: '15m', o: String(c.o), h: String(c.h), l: String(c.l), c: String(c.c), v: String(c.v), n: c.n ?? 1 },
    })),
    sendMids: (mids) => last()?.send(JSON.stringify({
      channel: 'allMids',
      data: { mids: Object.fromEntries(Object.entries(mids).map(([k, v]) => [k, String(v)])) },
    })),
    dropClients: () => { sockets.forEach((s) => s.terminate()); sockets = []; },
    close: () => new Promise((r) => { sockets.forEach((s) => s.terminate()); wss.close(() => r()); }),
  };
}
