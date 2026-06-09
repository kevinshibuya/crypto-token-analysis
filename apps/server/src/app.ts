import Fastify, { FastifyInstance } from 'fastify';
import { registerHealthRoute } from './routes/health';

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  registerHealthRoute(app);
  return app;
}
