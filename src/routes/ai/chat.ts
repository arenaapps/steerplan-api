import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Anthropic from '@anthropic-ai/sdk';
import { anthropic } from '../../lib/anthropic.js';
import { SYSTEM_INSTRUCTION_TEMPLATE } from '../../lib/system-instruction.js';
import { supabase } from '../../lib/supabase.js';
import { aiChatLimiter, checkRateLimit, rateLimitHeaders } from '../../lib/rate-limit.js';
import { TOOLS, AUTO_EXECUTE_TOOLS, CONFIRMATION_TOOLS } from '../../lib/tools.js';
import { executeAutoTool } from '../../lib/tool-executors.js';
import { retrieveContext } from '../../lib/rag.js';
import { Redis } from '@upstash/redis';
import { config } from '../../config.js';
import { randomUUID } from 'crypto';

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
const MAX_TOOL_ITERATIONS = 5;

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

function getRedis(): Redis | null {
  if (!config.upstash.configured) return null;
  return new Redis({ url: config.upstash.url, token: config.upstash.token });
}

/** Extract all text blocks from a Claude message response */
function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
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

    // Retrieve RAG context (fire in parallel with system instruction build)
    let ragContext = '';
    try {
      ragContext = await retrieveContext(userId, message);
    } catch (err: any) {
      request.log.error(`RAG retrieval failed: ${err.message}`);
    }

    const ragSection = ragContext
      ? `## Retrieved Financial Context\nThe following data was retrieved based on relevance to the user's question. Use it to provide accurate, specific answers.\n\n${ragContext}`
      : '';

    const systemInstruction = SYSTEM_INSTRUCTION_TEMPLATE
      .replace('{{USER_NAME}}', userName || 'there')
      .replace('{{DASHBOARD_STATE}}', JSON.stringify(context || {}))
      .replace('{{ACCOUNT_CONTEXT}}', accountContext || '')
      .replace('{{FINANCE_LITERACY}}', financeLiteracy || 'intermediate')
      .replace('{{RAG_CONTEXT}}', ragSection);

    const messages: Anthropic.MessageParam[] = [
      ...(history || []).map((m: { role: string; text: string }) => ({
        role: (m.role === 'model' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: m.text,
      })),
      { role: 'user', content: message },
    ];

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
      // ── Agentic loop: up to MAX_TOOL_ITERATIONS ──
      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
        const isLastIteration = iteration === MAX_TOOL_ITERATIONS - 1;

        // For intermediate iterations, use non-streaming to collect tool_use blocks easily.
        // For the final response (end_turn), stream text for typing animation.
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: systemInstruction,
          messages,
          tools: isLastIteration ? undefined : TOOLS,
        });

        const stopReason = response.stop_reason;

        // ── end_turn: stream the final text to the client ──
        if (stopReason === 'end_turn' || stopReason === 'max_tokens') {
          const text = extractText(response.content);

          // Stream the text character-by-character in chunks for typing animation
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
          break;
        }

        // ── tool_use: process tool calls ──
        if (stopReason === 'tool_use') {
          const toolUseBlocks = response.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
          );

          // Check if any tool requires confirmation
          const confirmationTool = toolUseBlocks.find((t) => CONFIRMATION_TOOLS.has(t.name));

          if (confirmationTool) {
            // Stream any text that came before the tool call
            const textBeforeTool = extractText(response.content);
            if (textBeforeTool) {
              fullText += textBeforeTool;
              reply.raw.write(`data: ${JSON.stringify({ type: 'delta', text: textBeforeTool })}\n\n`);
            }

            // Store conversation state in Redis for resumption
            const paymentId = randomUUID();
            const redis = getRedis();

            if (redis) {
              const pendingState = {
                userId,
                messages,
                responseContent: response.content,
                toolBlock: confirmationTool,
                systemInstruction,
                fullTextSoFar: fullText,
              };

              await redis.set(`payment:${paymentId}`, JSON.stringify(pendingState), { ex: 300 });
            }

            // Build payment details for the confirmation sheet
            const toolInput = confirmationTool.input as Record<string, any>;
            const paymentDetails = {
              type: confirmationTool.name === 'create_standing_order' ? 'standing_order' : 'one_off',
              recipient_name: toolInput.recipient_name,
              amount: toolInput.amount,
              currency: 'GBP',
              reference: toolInput.reference,
              sort_code: toolInput.sort_code,
              account_number: toolInput.account_number,
              source_account_id: toolInput.source_account_id,
              ...(confirmationTool.name === 'create_standing_order' && {
                frequency: toolInput.frequency,
                start_date: toolInput.start_date,
              }),
            };

            // Emit payment_pending event
            reply.raw.write(
              `data: ${JSON.stringify({
                type: 'payment_pending',
                paymentId,
                details: paymentDetails,
              })}\n\n`
            );

            // Send a done event with text so far (if any)
            const { text: cleanText, uiBlocks, suggestedQuestions } = parseResponse(fullText || '');
            reply.raw.write(
              `data: ${JSON.stringify({
                type: 'done',
                text: cleanText || '',
                uiBlocks: uiBlocks ?? null,
                suggestedQuestions: suggestedQuestions ?? null,
              })}\n\n`
            );
            break;
          }

          // All tools are auto-execute — run them and continue the loop
          // Append the assistant's response (with tool_use blocks) to messages
          messages.push({ role: 'assistant', content: response.content });

          // Execute each auto tool and collect results
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const toolBlock of toolUseBlocks) {
            if (AUTO_EXECUTE_TOOLS.has(toolBlock.name)) {
              try {
                const result = await executeAutoTool(
                  toolBlock.name,
                  toolBlock.input as Record<string, any>,
                  userId,
                );
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolBlock.id,
                  content: result,
                });
              } catch (err: any) {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolBlock.id,
                  content: JSON.stringify({ error: err?.message ?? 'Tool execution failed' }),
                  is_error: true,
                });
              }
            }
          }

          // Append tool results as user message
          messages.push({ role: 'user', content: toolResults });
          // Continue the loop — Claude will process tool results
          continue;
        }

        // Unknown stop reason — break
        break;
      }
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
