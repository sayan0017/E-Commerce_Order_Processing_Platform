/**
 * Redis Caching Wrapper — Cache-Aside Pattern
 *
 * Provides a generic, type-safe caching layer with:
 * - `getOrSet<T>()`: Cache-aside pattern — fetch from cache, fallback to DB, cache result
 * - `invalidateKey()`: Single-key invalidation
 * - `invalidatePattern()`: Pattern-based invalidation (e.g., `products:list:*`)
 *
 * Designed to cut response times by 60%+ on product listing and detail endpoints.
 */

import Redis from 'ioredis';
import { config } from '../config';

class RedisCache {
  private client: Redis;
  private isConnected: boolean = false;

  constructor() {
    this.client = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        const delay = Math.min(times * 200, 5000);
        return delay;
      },
      enableReadyCheck: true,
      lazyConnect: true,
    });

    this.client.on('connect', () => {
      this.isConnected = true;
      console.log('📦 Redis connected');
    });

    this.client.on('error', (err) => {
      this.isConnected = false;
      console.error('Redis error:', err.message);
    });

    this.client.on('close', () => {
      this.isConnected = false;
    });
  }

  /**
   * Initialize the Redis connection.
   */
  async connect(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      console.error('Redis connection failed:', error);
      // Service continues without cache — graceful degradation
    }
  }

  /**
   * Cache-aside pattern: Try cache first, fallback to fetcher, cache result.
   *
   * @param key - Redis cache key
   * @param ttlSeconds - Time-to-live in seconds
   * @param fetcher - Function to call if cache misses (DB query, etc.)
   * @returns The cached or freshly-fetched data
   */
  async getOrSet<T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> {
    // Graceful degradation: if Redis is down, skip cache
    if (!this.isConnected) {
      return fetcher();
    }

    try {
      // 1. Try cache
      const cached = await this.client.get(key);
      if (cached !== null) {
        return JSON.parse(cached) as T;
      }

      // 2. Cache miss — call the fetcher
      const data = await fetcher();

      // 3. Store in cache (non-blocking — don't await to avoid latency)
      this.client
        .setex(key, ttlSeconds, JSON.stringify(data))
        .catch((err) => console.error('Redis SET error:', err.message));

      return data;
    } catch (error) {
      // On any Redis error, fall back to direct fetch
      console.error('Redis getOrSet error:', error);
      return fetcher();
    }
  }

  /**
   * Invalidate a single cache key.
   */
  async invalidateKey(key: string): Promise<void> {
    if (!this.isConnected) return;

    try {
      await this.client.del(key);
    } catch (error) {
      console.error('Redis invalidateKey error:', error);
    }
  }

  /**
   * Invalidate all keys matching a glob pattern.
   * Uses SCAN for production safety (non-blocking).
   *
   * @param pattern - Redis glob pattern, e.g., `products:list:*`
   */
  async invalidatePattern(pattern: string): Promise<void> {
    if (!this.isConnected) return;

    try {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;

        if (keys.length > 0) {
          await this.client.del(...keys);
        }
      } while (cursor !== '0');
    } catch (error) {
      console.error('Redis invalidatePattern error:', error);
    }
  }

  /**
   * Disconnect from Redis (for graceful shutdown).
   */
  async disconnect(): Promise<void> {
    await this.client.quit();
  }

  /**
   * Check if Redis is connected (for health checks).
   */
  get connected(): boolean {
    return this.isConnected;
  }
}

// Singleton instance
export const redisCache = new RedisCache();
