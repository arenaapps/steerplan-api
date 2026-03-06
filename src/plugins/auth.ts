import fp from 'fastify-plugin';
import { verifyToken } from '@clerk/backend';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('userId', '');

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const token = authHeader.slice(7);
    try {
      const payload = await verifyToken(token, {
        secretKey: config.clerk.secretKey,
      });
      request.userId = payload.sub;
    } catch {
      return reply.code(401).send({ error: 'Invalid token' });
    }
  });
});
