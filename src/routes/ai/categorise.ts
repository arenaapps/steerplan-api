import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { anthropic } from '../../lib/anthropic.js';
import { supabase } from '../../lib/supabase.js';
import { aiCategoriseLimiter, checkRateLimit, rateLimitHeaders } from '../../lib/rate-limit.js';

export async function categoriseRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request;

    const rl = await checkRateLimit(aiCategoriseLimiter, userId);
    if (rl && !rl.success) {
      reply.headers(rateLimitHeaders(rl));
      return reply.code(429).send({ error: 'Too many requests' });
    }

    try {
      const { lines } = request.body as { lines: string };
      if (!lines) return reply.send([]);

      // Check merchant rules for pre-assignment
      const { data: rules } = await supabase
        .from('merchant_category_rules')
        .select('merchant, category')
        .eq('user_id', userId);

      const ruleMap = new Map<string, string>();
      (rules || []).forEach((r: { merchant: string; category: string }) => {
        ruleMap.set(r.merchant.toLowerCase(), r.category);
      });

      const allLines = lines.split('\n').filter((l: string) => l.trim());
      const preAssigned: Record<string, string[]> = {};
      const unmatchedLines: string[] = [];

      for (const line of allLines) {
        const merchantName = line.split('|')[0]?.trim();
        const ruleCategory = merchantName ? ruleMap.get(merchantName.toLowerCase()) : undefined;
        if (ruleCategory) {
          if (!preAssigned[ruleCategory]) preAssigned[ruleCategory] = [];
          preAssigned[ruleCategory].push(merchantName);
        } else {
          unmatchedLines.push(line);
        }
      }

      const preAssignedResults = Object.entries(preAssigned).map(
        ([category, names]) => ({ category, names })
      );

      if (unmatchedLines.length === 0) {
        return reply.send(preAssignedResults);
      }

      const unmatchedText = unmatchedLines.join('\n');
      const prompt = `Group these merchants into spending categories. Format per line: name|total_spend\n\n${unmatchedText}\n\nReturn JSON only: [{"category":"Name","names":["merchant1","merchant2"]}]`;

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
            type: 'categorise',
            input: lines,
            output: raw,
            meta: { row_count: lines.split('\n').length },
          });
        } catch {}
      })();

      if (firstBracket !== -1 && lastBracket > firstBracket) {
        try {
          const aiResults = JSON.parse(cleaned.slice(firstBracket, lastBracket + 1)) as { category: string; names: string[] }[];
          for (const pre of preAssignedResults) {
            const existing = aiResults.find((r) => r.category === pre.category);
            if (existing) {
              existing.names.push(...pre.names);
            } else {
              aiResults.push(pre);
            }
          }
          return reply.send(aiResults);
        } catch { /* fall through */ }
      }

      return reply.send(preAssignedResults.length > 0 ? preAssignedResults : []);
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to categorise' });
    }
  });
}
