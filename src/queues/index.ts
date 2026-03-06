import { Redis } from 'ioredis';
import type { RedisOptions } from 'ioredis';
import { config } from '../config.js';

let connection: Redis | null = null;

export function getRedisConnection(): Redis | null {
  if (connection) return connection;
  if (!config.redis.configured) return null;

  connection = new Redis(config.redis.url, {
    maxRetriesPerRequest: null, // Required by BullMQ
  } as RedisOptions);

  return connection;
}
