import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import OpenAI from 'openai';
import { config } from '../../config.js';
import { aiTranscribeLimiter, checkRateLimit, rateLimitHeaders } from '../../lib/rate-limit.js';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

export async function transcribeRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request;

    // Rate limit
    const rl = await checkRateLimit(aiTranscribeLimiter, userId);
    if (rl && !rl.success) {
      reply.headers(rateLimitHeaders(rl));
      return reply.code(429).send({ error: 'Too many requests' });
    }

    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: 'No audio file provided' });
    }

    const buffer = await file.toBuffer();
    const audioFile = new File([buffer as BlobPart], file.filename || 'audio.m4a', {
      type: file.mimetype || 'audio/m4a',
    });

    const transcription = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file: audioFile,
    });

    return reply.send({ text: transcription.text });
  });
}
