import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { yapilyPost } from '../../lib/yapily.js';

export async function yapilyConsentRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as { institutionId: string; callbackUrl?: string };
      if (!body?.institutionId) {
        return reply.code(400).send({ error: 'Missing institutionId' });
      }

      const callback = body.callbackUrl || 'steerplan://yapily/callback';

      const result = await yapilyPost('/account-auth-requests', {
        applicationUserId: request.userId,
        institutionId: body.institutionId,
        callback,
      });

      const authorisationUrl: string | undefined =
        result.data?.authorisationUrl ?? result.authorisationUrl;

      if (!authorisationUrl) {
        request.log.error({ result }, 'Missing authorisationUrl from Yapily');
        return reply.code(500).send({ error: 'No authorisationUrl from Yapily' });
      }

      return reply.send({ authorisationUrl });
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to create consent' });
    }
  });
}
