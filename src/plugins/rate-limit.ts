import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  dataReadLimiter,
  dataWriteLimiter,
  checkRateLimit,
  rateLimitHeaders,
} from '../lib/rate-limit.js';

export const rateLimitPlugin = fp(async (app: FastifyInstance) => {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const isWrite = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method);
    const limiter = isWrite ? dataWriteLimiter : dataReadLimiter;
    const rl = await checkRateLimit(limiter, request.userId);
    if (rl && !rl.success) {
      reply.headers(rateLimitHeaders(rl));
      return reply.code(429).send({ error: 'Too many requests' });
    }
  });
});
