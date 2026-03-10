import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { finexerGet } from '../../lib/finexer.js';

export async function finexerProvidersRoutes(app: FastifyInstance) {
  app.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await finexerGet('/providers');
      const providers = (result.data ?? result ?? [])
        .filter((p: any) => Array.isArray(p.roles) && p.roles.includes('ais'))
        .map((p: any) => ({
          id: p.id,
          name: p.name,
          colors: p.bg_colors ?? [],
        }));

      return reply.send(providers);
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to fetch providers' });
    }
  });
}
