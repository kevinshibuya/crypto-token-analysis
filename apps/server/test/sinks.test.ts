import { describe, expect, it } from 'vitest';
import { TelegramSink } from '../src/engine/sinks/telegram';
import { DiscordSink } from '../src/engine/sinks/discord';
import { MacosSink } from '../src/engine/sinks/macos';
import { SinkDispatcher } from '../src/engine/sinks/dispatcher';
import { nullLogger } from '../src/engine/logger';
import type { Sink } from '../src/engine/sinks/types';

const okResponse = { ok: true, status: 200 } as Response;
const failResponse = { ok: false, status: 500 } as Response;

describe('TelegramSink', () => {
  it('POSTs sendMessage with chat id and HTML parse mode', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const sink = new TelegramSink({
      token: 'TOK', chatId: '42',
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(init.body as string) });
        return okResponse;
      }) as unknown as typeof fetch,
    });
    await sink.send('hello <b>world</b>');
    expect(calls[0].url).toBe('https://api.telegram.org/botTOK/sendMessage');
    expect(calls[0].body).toEqual({ chat_id: '42', text: 'hello <b>world</b>', parse_mode: 'HTML', disable_web_page_preview: true });
  });

  it('throws on non-2xx so the dispatcher can retry', async () => {
    const sink = new TelegramSink({ token: 'T', chatId: 'c', fetchImpl: (async () => failResponse) as unknown as typeof fetch });
    await expect(sink.send('x')).rejects.toThrow(/500/);
  });
});

describe('DiscordSink', () => {
  it('POSTs the webhook with content truncated to 2000 chars', async () => {
    const calls: { url: string; body: { content: string } }[] = [];
    const sink = new DiscordSink({
      webhookUrl: 'https://discord/hook',
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(init.body as string) });
        return okResponse;
      }) as unknown as typeof fetch,
    });
    await sink.send('y'.repeat(2500));
    expect(calls[0].url).toBe('https://discord/hook');
    expect(calls[0].body.content).toHaveLength(2000);
  });
});

describe('MacosSink', () => {
  it('invokes terminal-notifier with title and message', async () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const sink = new MacosSink({ execImpl: async (cmd, args) => { calls.push({ cmd, args }); } });
    await sink.send('line1\nline2');
    expect(calls[0].cmd).toBe('terminal-notifier');
    expect(calls[0].args).toEqual(['-title', 'CTA Engine', '-message', 'line1\nline2']);
  });

  it('falls back to osascript when terminal-notifier is missing', async () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const sink = new MacosSink({
      execImpl: async (cmd, args) => {
        calls.push({ cmd, args });
        if (cmd === 'terminal-notifier') { const e = new Error('not found') as NodeJS.ErrnoException; e.code = 'ENOENT'; throw e; }
      },
    });
    await sink.send('it has "quotes" in it');
    expect(calls[1].cmd).toBe('osascript');
    expect(calls[1].args[1]).toContain('display notification');
    expect(calls[1].args[1]).not.toContain('"quotes"'); // quotes escaped, not raw
  });
});

describe('SinkDispatcher', () => {
  const sink = (name: string, behavior: () => Promise<void>): Sink => ({ name, send: behavior });

  it('returns the names of sinks that accepted; a failing sink never blocks the others', async () => {
    let aCalls = 0;
    const d = new SinkDispatcher({
      sinks: [
        sink('a', async () => { aCalls++; throw new Error('down'); }),
        sink('b', async () => {}),
      ],
      log: nullLogger(), attempts: 3, baseDelayMs: 1, sleep: async () => {},
    });
    const delivered = await d.dispatch('msg');
    expect(delivered).toEqual(['b']);
    expect(aCalls).toBe(3); // 3 attempts then gave up, no throw out of dispatch
  });

  it('retries with backoff and succeeds on a later attempt', async () => {
    let n = 0;
    const delays: number[] = [];
    const d = new SinkDispatcher({
      sinks: [sink('flaky', async () => { if (++n < 3) throw new Error('blip'); })],
      log: nullLogger(), attempts: 3, baseDelayMs: 100, sleep: async (ms) => { delays.push(ms); },
    });
    expect(await d.dispatch('msg')).toEqual(['flaky']);
    expect(delays).toEqual([100, 200]); // exponential
  });

  it('dispatches to all sinks concurrently (not sequentially)', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const d = new SinkDispatcher({
      sinks: [
        sink('slow', async () => { order.push('slow-start'); await gate; order.push('slow-end'); }),
        sink('fast', async () => { order.push('fast'); }),
      ],
      log: nullLogger(), attempts: 1, baseDelayMs: 1, sleep: async () => {},
    });
    const p = d.dispatch('msg');
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['slow-start', 'fast']); // fast finished while slow is blocked
    release();
    expect(await p).toEqual(['slow', 'fast']);
  });
});
