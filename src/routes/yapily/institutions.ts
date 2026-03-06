import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { yapilyGet } from '../../lib/yapily.js';

export async function yapilyInstitutionsRoutes(app: FastifyInstance) {
  app.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = await yapilyGet('/institutions');
      const institutions = (data.data || []).map((i: any) => ({
        id: i.id,
        name: i.name,
        media: (i.media || []).map((m: any) => ({ source: m.source, type: m.type })),
      }));
      return reply.send(institutions);
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to fetch institutions' });
    }
  });
}
