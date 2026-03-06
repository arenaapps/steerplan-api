import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from 'fastify';

export const errorHandlerPlugin = fp(async (app: FastifyInstance) => {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const statusCode = error.statusCode || 500;
    request.log.error(error);
    reply.code(statusCode).send({
      error: statusCode >= 500 ? 'Internal Server Error' : error.message,
    });
  });
});
