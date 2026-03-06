import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { anthropic } from '../../lib/anthropic.js';
import { aiBriefingLimiter, checkRateLimit, rateLimitHeaders } from '../../lib/rate-limit.js';

export async function briefingRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request;

    const rl = await checkRateLimit(aiBriefingLimiter, userId);
    if (rl && !rl.success) {
      reply.headers(rateLimitHeaders(rl));
      return reply.code(429).send({ error: 'Too many requests' });
    }

    try {
      const { state } = request.body as { state: any };

      const prompt = `You are a personal CFO agent for Steerplan. Analyse this user's financial dashboard and return exactly 3 short, data-backed insights.

Dashboard:
${JSON.stringify(state)}

Rules:
- Each insight must reference a specific number from the data
- 1–2 sentences max per insight
- Focus on what is most actionable or urgent right now
- No investment advice
- No preamble or headers

Return only valid JSON: { "insights": ["insight 1", "insight 2", "insight 3"] }`;

      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      });

      const raw = response.content[0].type === 'text' ? response.content[0].text : '';
      const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');

      if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
          const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
          if (Array.isArray(parsed.insights)) {
            return reply.send({ insights: parsed.insights.slice(0, 3) });
          }
        } catch { /* fall through */ }
      }

      return reply.send({ insights: [] });
    } catch (error: any) {
      return reply.code(500).send({ error: error?.message || 'Failed to generate briefing' });
    }
  });
}
