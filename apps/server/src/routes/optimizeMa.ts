import type { FastifyInstance } from 'fastify';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Manual optimizer trigger for testing and the e2e — deliberately loopback-only. */
export function registerOptimizeMaRoute(
  app: FastifyInstance,
  run: (coins?: string[]) => Promise<unknown>,
): void {
  app.post('/engine/optimize-ma', {
    schema: {
      querystring: {
        type: 'object',
        properties: { coins: { type: 'string' } },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    if (!LOOPBACK.has(req.ip)) return reply.code(403).send({ error: 'local only' });
    const raw = (req.query as { coins?: string }).coins;
    const coins = raw
      ? raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
      : undefined;
    return run(coins && coins.length ? coins : undefined);
  });
}
