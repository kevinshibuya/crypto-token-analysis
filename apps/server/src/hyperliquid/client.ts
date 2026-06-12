import type { Candle } from '@cta/core';
import { HYPERLIQUID_BASE_URL } from '../config';

export interface HyperliquidClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number; // retries on 429/5xx/network (default 4)
  baseDelayMs?: number; // first backoff delay in ms (default 500)
  sleep?: (ms: number) => Promise<void>;
}

interface RawCandle {
  t: number; T: number; o: string; h: string; l: string; c: string; v: string; n: number; s: string; i: string;
}

export interface MetaUniverseItem {
  name: string;
  szDecimals: number;
  maxLeverage: number;
}

interface RawAssetCtx {
  dayNtlVlm: string;
}

export class HyperliquidClient {
  private baseUrl: string;
  private f: typeof fetch;
  private maxRetries: number;
  private baseDelayMs: number;
  private sleep: (ms: number) => Promise<void>;

  constructor(opts: HyperliquidClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? HYPERLIQUID_BASE_URL;
    this.f = opts.fetchImpl ?? fetch;
    this.maxRetries = opts.maxRetries ?? 4;
    this.baseDelayMs = opts.baseDelayMs ?? 500;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async post<T>(body: unknown): Promise<T> {
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.f(`${this.baseUrl}/info`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (networkErr) {
        if (attempt >= this.maxRetries) {
          // statusCode 502 so Fastify answers Bad Gateway instead of a generic 500
          throw Object.assign(new Error(`Hyperliquid unreachable: ${String(networkErr)}`), {
            statusCode: 502, cause: networkErr,
          });
        }
        await this.sleep(this.baseDelayMs * 2 ** attempt++);
        continue;
      }
      if (res.ok) return (await res.json()) as T;
      if ((res.status === 429 || res.status >= 500) && attempt < this.maxRetries) {
        await this.sleep(this.baseDelayMs * 2 ** attempt++);
        continue;
      }
      // `status` = upstream HTTP status; `statusCode` 502 = what our routes answer
      throw Object.assign(new Error(`Hyperliquid request failed: ${res.status}`), {
        status: res.status, statusCode: 502,
      });
    }
  }

  async meta(): Promise<{ universe: MetaUniverseItem[] }> {
    return this.post({ type: 'meta' });
  }

  async metaAndAssetCtxs(): Promise<{ universe: MetaUniverseItem[]; assetCtxs: { dayNtlVlm: number }[] }> {
    const [meta, ctxs] = await this.post<[{ universe: MetaUniverseItem[] }, RawAssetCtx[]]>({
      type: 'metaAndAssetCtxs',
    });
    return { universe: meta.universe, assetCtxs: ctxs.map((c) => ({ dayNtlVlm: +c.dayNtlVlm })) };
  }

  async candleSnapshot(coin: string, interval: string, startTime: number, endTime: number): Promise<Candle[]> {
    const raw = await this.post<RawCandle[]>({
      type: 'candleSnapshot',
      req: { coin, interval, startTime, endTime },
    });
    return raw.map((r) => ({ t: r.t, o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: +r.v, n: r.n }));
  }
}
