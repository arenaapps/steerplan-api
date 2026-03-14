import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { anthropic } from '../../lib/anthropic.js';
import { supabase } from '../../lib/supabase.js';
import { aiCategoriseLimiter, checkRateLimit, rateLimitHeaders } from '../../lib/rate-limit.js';

interface InflowEntry {
  description: string;
  totalAmount: number;
  count: number;
  avgAmount: number;
  frequency: 'day' | 'week' | 'month';
}

interface ClassifiedIncome {
  label: string;
  originalDescription: string;
  amount: number;
  frequency: 'day' | 'week' | 'month';
  category: string;
  confidence: 'high' | 'medium' | 'low';
}

export async function classifyIncomeRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request;

    const rl = await checkRateLimit(aiCategoriseLimiter, userId);
    if (rl && !rl.success) {
      reply.headers(rateLimitHeaders(rl));
      return reply.code(429).send({ error: 'Too many requests' });
    }

    try {
      const { inflows } = request.body as { inflows: InflowEntry[] };
      if (!inflows || inflows.length === 0) return reply.send([]);

      const lines = inflows
        .map((i) => `${i.description}|£${i.avgAmount.toFixed(2)}|${i.count}x|${i.frequency}`)
        .join('\n');

      const prompt = `You are a financial analyst. Classify these recurring bank inflows as income sources.

For each entry: description|average_amount|occurrence_count|estimated_frequency

${lines}

For each entry, determine:
- A clean, human-readable label (e.g. "Salary - Acme Ltd", "Freelance Income", "Child Benefit")
- A category: one of "salary", "freelance", "benefits", "pension", "rental", "investment", "refund", "transfer", "other"
- Confidence: "high" if clearly income (salary, regular payments), "medium" if likely income, "low" if probably not income (refunds, transfers between own accounts)

Only include items that are likely genuine income (confidence high or medium). Exclude refunds, internal transfers, and one-off payments.

Return JSON only: [{"label":"Clean Label","originalDescription":"original desc","amount":1234.56,"frequency":"month","category":"salary","confidence":"high"}]`;

      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });

      const raw = response.content[0].type === 'text' ? response.content[0].text : '';
      const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const firstBracket = cleaned.indexOf('[');
      const lastBracket = cleaned.lastIndexOf(']');

      // Fire-and-forget logging
      void (async () => {
        try {
          await supabase.from('ai_query_log').insert({
            user_id: userId,
            type: 'classify-income',
            input: lines,
            output: raw,
            meta: { inflow_count: inflows.length },
          });
        } catch {}
      })();

      if (firstBracket !== -1 && lastBracket > firstBracket) {
        try {
          const results = JSON.parse(cleaned.slice(firstBracket, lastBracket + 1)) as ClassifiedIncome[];
          return reply.send(results);
        } catch { /* fall through */ }
      }

      return reply.send([]);
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to classify income' });
    }
  });
}
