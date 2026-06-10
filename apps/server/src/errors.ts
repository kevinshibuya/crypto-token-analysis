// Fastify maps `statusCode` on thrown errors automatically
export function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}
