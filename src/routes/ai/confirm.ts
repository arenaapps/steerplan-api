import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Anthropic from '@anthropic-ai/sdk';
import { anthropic } from '../../lib/anthropic.js';
import { supabase } from '../../lib/supabase.js';
import { executeConfirmationTool } from '../../lib/tool-executors.js';
import { aiPaymentConfirmLimiter, checkRateLimit, rateLimitHeaders } from '../../lib/rate-limit.js';
import { Redis } from '@upstash/redis';
import { config } from '../../config.js';

function getRedis(): Redis | null {
  if (!config.upstash.configured) return null;
  return new Redis({ url: config.upstash.url, token: config.upstash.token });
}

function parseSuggestionsFromText(text: string): { text: string; suggestedQuestions?: string[] } {
  const match = text.match(/\[suggestions:\s*(.+)\]\s*$/);
  if (!match) return { text };
  const raw = match[1];
  const questions = Array.from(raw.matchAll(/"([^"]+)"/g)).map((m) => m[1]);
  return {
    text: text.replace(match[0], '').trim(),
    suggestedQuestions: questions.length > 0 ? questions : undefined,
  };
}

function parseResponse(raw: string): { text: string; uiBlocks?: any[]; suggestedQuestions?: string[] } {
  let strippedText = raw.trim();
  let parsedText: string | undefined;
  let parsedBlocks: any[] | undefined;
  let parsedSuggestions: string[] | undefined;

  const fencedJsonRegex = /```json\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = fencedJsonRegex.exec(raw)) !== null) {
    const jsonCandidate = match[1].trim();
    try {
      const parsed = JSON.parse(jsonCandidate);
      if (parsed) {
        if (typeof parsed.text === 'string') parsedText = parsed.text;
        if (Array.isArray(parsed.uiBlocks)) parsedBlocks = parsed.uiBlocks;
        if (Array.isArray(parsed.suggestedQuestions)) parsedSuggestions = parsed.suggestedQuestions;
      }
    } catch { /* ignore */ }
    strippedText = strippedText.replace(match[0], '').trim();
  }

  const cleaned = strippedText.replace(/^```json/i, '').replace(/```$/i, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      if (typeof parsed.text === 'string') parsedText = parsed.text;
      if (Array.isArray(parsed.uiBlocks)) parsedBlocks = parsed.uiBlocks;
      if (Array.isArray(parsed.suggestedQuestions)) parsedSuggestions = parsed.suggestedQuestions;
    } catch { /* not valid JSON */ }
  }

  const finalText = parsedText || strippedText || raw;
  if (!parsedSuggestions) {
    const { text: cleanedText, suggestedQuestions } = parseSuggestionsFromText(finalText);
    return { text: cleanedText, uiBlocks: parsedBlocks, suggestedQuestions };
  }

  return { text: finalText, uiBlocks: parsedBlocks, suggestedQuestions: parsedSuggestions };
}

export async function confirmRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request;
    const { paymentId, confirmed } = request.body as { paymentId: string; confirmed: boolean };

    if (!paymentId) {
      return reply.code(400).send({ error: 'paymentId is required' });
    }

    // Rate limit: 3 confirmations per minute
    const rl = await checkRateLimit(aiPaymentConfirmLimiter, userId);
    if (rl && !rl.success) {
      reply.headers(rateLimitHeaders(rl));
      return reply.code(429).send({ error: 'Too many requests' });
    }

    const redis = getRedis();
    if (!redis) {
      return reply.code(500).send({ error: 'Payment service unavailable' });
    }

    // Retrieve pending payment state
    const stateRaw = await redis.get<string>(`payment:${paymentId}`);
    if (!stateRaw) {
      return reply.code(410).send({ error: 'Payment expired or not found. Please try again.' });
    }

    const state = typeof stateRaw === 'string' ? JSON.parse(stateRaw) : stateRaw;

    // Validate ownership
    if (state.userId !== userId) {
      return reply.code(403).send({ error: 'Unauthorized' });
    }

    // Delete the Redis key immediately to prevent replay
    await redis.del(`payment:${paymentId}`);

    // Build tool_result based on confirmation
    let toolResultContent: string;

    if (confirmed) {
      try {
        const toolBlock = state.toolBlock as Anthropic.ToolUseBlock;
        toolResultContent = await executeConfirmationTool(
          toolBlock.name,
          toolBlock.input as Record<string, any>,
          userId,
        );
      } catch (err: any) {
        toolResultContent = JSON.stringify({
          error: true,
          message: err?.message ?? 'Payment failed. Please try again.',
        });
      }
    } else {
      toolResultContent = JSON.stringify({
        cancelled: true,
        message: 'User cancelled the payment.',
      });
    }

    // Resume Claude conversation with the tool_result
    const toolBlock = state.toolBlock as Anthropic.ToolUseBlock;
    const resumedMessages: Anthropic.MessageParam[] = [
      ...state.messages,
      { role: 'assistant', content: state.responseContent },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result' as const,
            tool_use_id: toolBlock.id,
            content: toolResultContent,
          },
        ],
      },
    ];

    // Hijack reply for SSE streaming of Claude's follow-up
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });

    let fullText = '';
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: state.systemInstruction,
        messages: resumedMessages,
      });

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      // Stream in chunks for typing animation
      const chunkSize = 8;
      for (let i = 0; i < text.length; i += chunkSize) {
        const chunk = text.slice(i, i + chunkSize);
        fullText += chunk;
        reply.raw.write(`data: ${JSON.stringify({ type: 'delta', text: chunk })}\n\n`);
      }

      const { text: cleanText, uiBlocks, suggestedQuestions } = parseResponse(fullText);
      reply.raw.write(
        `data: ${JSON.stringify({
          type: 'done',
          text: cleanText,
          uiBlocks: uiBlocks ?? null,
          suggestedQuestions: suggestedQuestions ?? null,
        })}\n\n`
      );
    } catch (err: any) {
      reply.raw.write(
        `data: ${JSON.stringify({ type: 'error', error: err?.message ?? 'Stream error' })}\n\n`
      );
    } finally {
      reply.raw.end();
    }

    // Fire-and-forget logging
    void supabase
      .from('ai_query_log')
      .insert({
        user_id: userId,
        type: 'payment_confirm',
        input: JSON.stringify({ paymentId, confirmed }),
        output: fullText,
      })
      .then(() => {}, () => {});
  });
}
