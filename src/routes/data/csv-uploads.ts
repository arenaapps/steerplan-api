import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../../lib/supabase.js';

export async function csvUploadsRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { filename, raw_content, detected_columns, row_count } = request.body as {
        filename: string;
        raw_content: string;
        detected_columns: string[];
        row_count: number;
      };

      await supabase.from('csv_uploads').insert({
        user_id: request.userId,
        filename,
        raw_content,
        detected_columns,
        row_count,
      });

      return reply.send({ ok: true });
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message });
    }
  });
}
