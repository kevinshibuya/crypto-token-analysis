// apps/server/test/helpers/sse.ts — SSE frame parsing over a fetch body, shared by live tests.

export interface SseEvent { event: string; data: unknown }

/** Parse complete `event:`/`data:` frames out of `buf` into `sink`; returns the unconsumed tail. */
function parseFrames(buf: string, sink: SseEvent[]): string {
  let idx;
  while ((idx = buf.indexOf('\n\n')) >= 0) {
    const block = buf.slice(0, idx);
    buf = buf.slice(idx + 2);
    const ev = /^event: (.+)$/m.exec(block)?.[1];
    const data = /^data: (.+)$/m.exec(block)?.[1];
    if (ev && data) sink.push({ event: ev, data: JSON.parse(data) });
  }
  return buf;
}

/**
 * Continuously parse SSE frames from a fetch body into `sink` (comment frames are skipped).
 * Lets a test observe one open stream across phases. `stop()` cancels the reader and waits
 * for the pump to exit; `done` resolves when the stream ends or is cancelled.
 */
export function pumpEvents(body: ReadableStream<Uint8Array>, sink: SseEvent[]):
  { stop: () => Promise<void>; done: Promise<void> } {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const done = (async () => {
    try {
      for (;;) {
        const { value, done: ended } = await reader.read();
        if (ended) return;
        buf = parseFrames(buf + decoder.decode(value, { stream: true }), sink);
      }
    } catch { /* reader cancelled or stream torn down */ }
  })();
  return {
    done,
    stop: async () => { await reader.cancel().catch(() => {}); await done; },
  };
}

/** Read SSE frames from a fetch body until `count` event frames arrived (or timeout / stream end). */
export async function readEvents(body: ReadableStream<Uint8Array>, count: number, timeoutMs = 5_000):
  Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  const pump = pumpEvents(body, events);
  let ended = false;
  void pump.done.then(() => { ended = true; });
  const deadline = Date.now() + timeoutMs;
  while (events.length < count && !ended && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
  await pump.stop();
  return events;
}
