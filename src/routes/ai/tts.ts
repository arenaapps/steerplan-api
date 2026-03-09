import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import OpenAI from 'openai';
import { config } from '../../config.js';
import { aiTranscribeLimiter, checkRateLimit, rateLimitHeaders } from '../../lib/rate-limit.js';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

export async function ttsRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request;

    const rl = await checkRateLimit(aiTranscribeLimiter, userId);
    if (rl && !rl.success) {
      reply.headers(rateLimitHeaders(rl));
      return reply.code(429).send({ error: 'Too many requests' });
    }

    const { text } = request.body as { text?: string };
    if (!text || !text.trim()) {
      return reply.code(400).send({ error: 'No text provided' });
    }

    // Cap at 4096 chars (OpenAI TTS limit)
    const trimmed = text.slice(0, 4096);

    const response = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'nova',
      input: trimmed,
      response_format: 'aac',
    });

    const buffer = Buffer.from(await response.arrayBuffer());

    return reply
      .header('Content-Type', 'audio/aac')
      .header('Content-Length', buffer.length)
      .send(buffer);
  });
}
