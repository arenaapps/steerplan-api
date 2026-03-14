import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../../lib/supabase.js';
import { addEquifaxJob } from '../../queues/jobs.js';

export async function equifaxInsightsRoutes(app: FastifyInstance) {
  // GET latest insights + history
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request;

    try {
      // Latest score
      const { data: latest } = await supabase
        .from('credit_scores')
        .select('*')
        .eq('user_id', userId)
        .order('scored_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Score history for trends (last 12 entries)
      const { data: history } = await supabase
        .from('credit_scores')
        .select('fhi_score, bureau_score, scored_at')
        .eq('user_id', userId)
        .order('scored_at', { ascending: false })
        .limit(12);

      return reply.send({
        current: latest
          ? {
              fhiScore: latest.fhi_score,
              fhiFlags: latest.fhi_flags || [],
              incomeGrade: latest.income_grade,
              disposableIncome: latest.disposable_income,
              totalIncome: latest.total_income,
              totalExpenditure: latest.total_expenditure,
              bureauScore: latest.bureau_score,
              source: latest.source,
              scoredAt: latest.scored_at,
            }
          : null,
        history: (history || []).reverse().map((h: any) => ({
          date: h.scored_at,
          fhiScore: h.fhi_score,
          bureauScore: h.bureau_score,
        })),
      });
    } catch (error: any) {
      request.log.error(`Equifax insights fetch failed: ${error.message}`);
      return reply.code(500).send({ error: 'Failed to fetch insights' });
    }
  });

  // POST refresh insights
  app.post('/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request;

    try {
      // Check if user has equifax customer mapping
      const { data: customer } = await supabase
        .from('equifax_customers')
        .select('equifax_customer_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (!customer) {
        // Need to enrich first
        await addEquifaxJob('enrich', { userId });
      } else {
        await addEquifaxJob('fetch-insights', { userId });
      }

      return reply.send({ ok: true, queued: true });
    } catch (error: any) {
      request.log.error(`Equifax insights refresh failed: ${error.message}`);
      return reply.code(500).send({ error: 'Failed to queue refresh' });
    }
  });
}
