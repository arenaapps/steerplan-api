import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

export const corsPlugin = fp(async (app: FastifyInstance) => {
  await app.register(cors, {
    origin: [
      'steerplan://',
      /^https?:\/\/localhost(:\d+)?$/,
      /^https:\/\/(.*\.)?steerplan\.com$/,
    ],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });
});
