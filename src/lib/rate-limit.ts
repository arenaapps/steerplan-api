import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { config } from '../config.js';

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;
  if (!config.upstash.configured) return null;
  redis = new Redis({ url: config.upstash.url, token: config.upstash.token });
  return redis;
}

function createLimiter(
  prefix: string,
  tokens: number,
  window: Parameters<typeof Ratelimit.slidingWindow>[1]
): Ratelimit | null {
  const r = getRedis();
  if (!r) return null;
  return new Ratelimit({
    redis: r,
    prefix: `rl:${prefix}`,
    limiter: Ratelimit.slidingWindow(tokens, window),
    analytics: true,
  });
}

// IP-level: 60 req/min
export const ipLimiter = createLimiter('ip', 60, '1 m');

// Per-user AI route limiters
export const aiChatLimiter = createLimiter('ai-chat', 5, '1 m');
export const aiCategoriseLimiter = createLimiter('ai-cat', 10, '1 h');
export const aiBriefingLimiter = createLimiter('ai-brief', 10, '1 h');
export const aiTranscribeLimiter = createLimiter('ai-transcribe', 10, '1 m');

// Per-user payment confirmation limiter
export const aiPaymentConfirmLimiter = createLimiter('ai-pay-confirm', 3, '1 m');

// Per-user data route limiters
export const dataWriteLimiter = createLimiter('data-w', 30, '1 m');
export const dataReadLimiter = createLimiter('data-r', 60, '1 m');

export async function checkRateLimit(
  limiter: Ratelimit | null,
  identifier: string
): Promise<{ success: boolean; limit: number; remaining: number; reset: number } | null> {
  if (!limiter) return null;
  const result = await limiter.limit(identifier);
  return {
    success: result.success,
    limit: result.limit,
    remaining: result.remaining,
    reset: result.reset,
  };
}

export function rateLimitHeaders(result: { limit: number; remaining: number; reset: number }): Record<string, string> {
  return {
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(result.remaining),
    'RateLimit-Reset': String(result.reset),
    'Retry-After': String(Math.ceil((result.reset - Date.now()) / 1000)),
  };
}
