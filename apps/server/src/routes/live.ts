import type { FastifyInstance } from 'fastify';
import { LiveFeed, sseFrame } from '../engine/liveFeed';

export interface LiveRouteDeps {
  feed: LiveFeed;
  /** rankings + recent alerts + health, JSON-serializable, computed per connection */
  snapshot: () => unknown;
}

export function registerLiveRoute(app: FastifyInstance, deps: LiveRouteDeps): void {
  app.get('/live', (req, reply) => {
    reply.hijack(); // raw streaming — Fastify must not touch the response again
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');
    deps.feed.addClient(res, [sseFrame('snapshot', deps.snapshot())]);
  });
}
