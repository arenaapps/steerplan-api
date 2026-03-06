import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Anthropic from '@anthropic-ai/sdk';
import { anthropic } from '../../lib/anthropic.js';
import { SYSTEM_INSTRUCTION_TEMPLATE } from '../../lib/system-instruction.js';
import { supabase } from '../../lib/supabase.js';
import { aiChatLimiter, checkRateLimit, rateLimitHeaders } from '../../lib/rate-limit.js';

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

const FREE_DAILY_LIMIT = 10;

async function checkAndIncrementLimit(userId: string): Promise<{ allowed: boolean; used: number }> {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_pro, daily_ai_count, daily_ai_reset_at')
      .eq('clerk_user_id', userId)
      .maybeSingle();

    const isPro = profile?.is_pro ?? false;
    if (isPro) return { allowed: true, used: 0 };

    const today = new Date().toISOString().slice(0, 10);
    const lastReset = profile?.daily_ai_reset_at
      ? new Date(profile.daily_ai_reset_at).toISOString().slice(0, 10)
      : null;
    const count = lastReset === today ? (profile?.daily_ai_count ?? 0) : 0;

    if (count >= FREE_DAILY_LIMIT) return { allowed: false, used: count };

    await supabase
      .from('profiles')
      .upsert(
        { clerk_user_id: userId, daily_ai_count: count + 1, daily_ai_reset_at: new Date().toISOString() },
        { onConflict: 'clerk_user_id' }
      );

    return { allowed: true, used: count + 1 };
  } catch {
    return { allowed: false, used: FREE_DAILY_LIMIT };
  }
}

export async function chatRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request;

    // Per-user burst rate limit
    const rl = await checkRateLimit(aiChatLimiter, userId);
    if (rl && !rl.success) {
      reply.headers(rateLimitHeaders(rl));
      return reply.code(429).send({ error: 'Too many requests' });
    }

    const { allowed, used } = await checkAndIncrementLimit(userId);
    if (!allowed) {
      return reply.code(429).send({ error: 'DAILY_LIMIT_REACHED', limit: FREE_DAILY_LIMIT, used });
    }

    const { message, history, context, accountContext, userName, financeLiteracy } =
      request.body as any;

    const systemInstruction = SYSTEM_INSTRUCTION_TEMPLATE
      .replace('{{USER_NAME}}', userName || 'there')
      .replace('{{DASHBOARD_STATE}}', JSON.stringify(context || {}))
      .replace('{{ACCOUNT_CONTEXT}}', accountContext || '')
      .replace('{{FINANCE_LITERACY}}', financeLiteracy || 'intermediate');

    const messages: Anthropic.MessageParam[] = [
      ...(history || []).map((m: { role: string; text: string }) => ({
        role: (m.role === 'model' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: m.text,
      })),
      { role: 'user', content: message },
    ];

    const stream = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemInstruction,
      messages,
      stream: true,
    });

    // Hijack the reply to write raw SSE
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });

    let fullText = '';
    try {
      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          const text = event.delta.text;
          fullText += text;
          reply.raw.write(`data: ${JSON.stringify({ type: 'delta', text })}\n\n`);
        }
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
        type: 'chat',
        input: message,
        output: fullText,
        meta: {
          finance_literacy: financeLiteracy,
          history_length: (history || []).length,
          account_context_length: (accountContext || '').length,
        },
      })
      .then(() => {}, () => {});
  });
}
