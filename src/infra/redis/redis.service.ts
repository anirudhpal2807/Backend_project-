import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../config/config.service';

export interface RateLimitResult {
  allowed: boolean;
  totalHits: number;
  remaining: number;
  resetSeconds: number;
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: Redis;
  private isConnected = false;

  constructor(private readonly configService: AppConfigService) {}

  onModuleInit() {
    const redisUrl = this.configService.get('REDIS_URL');

    if (redisUrl) {
      this.client = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        enableOfflineQueue: false,
        tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
      });
    } else {
      this.client = new Redis({
        host: this.configService.get('REDIS_HOST'),
        port: this.configService.get('REDIS_PORT'),
        password: this.configService.get('REDIS_PASSWORD') || undefined,
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        enableOfflineQueue: false,
      });
    }

    this.client.on('connect', () => {
      this.isConnected = true;
    });

    this.client.on('error', () => {
      this.isConnected = false;
    });
  }

  get redis(): Redis {
    return this.client;
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      await this.client.ping();
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: (err as Error).message };
    }
  }

  /**
   * Sliding window rate limiter using Redis sorted sets (ZADD/ZREMRANGEBYSCORE)
   */
  async checkRateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    if (!this.isConnected) {
      // Fail-open policy if Redis is unreachable (log warning and permit request)
      return { allowed: true, totalHits: 1, remaining: limit - 1, resetSeconds: windowSeconds };
    }

    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;
    const redisKey = `ratelimit:${key}`;

    const multi = this.client.multi();
    // 1. Remove entries older than window
    multi.zremrangebyscore(redisKey, 0, windowStart);
    // 2. Count current hits
    multi.zcard(redisKey);
    // 3. Add current request
    multi.zadd(redisKey, now, `${now}-${Math.random()}`);
    // 4. Set expiry
    multi.expire(redisKey, windowSeconds);

    try {
      const results = await multi.exec();
      const currentCount = (results?.[1]?.[1] as number) || 0;

      const allowed = currentCount < limit;
      const remaining = Math.max(0, limit - (currentCount + 1));

      return {
        allowed,
        totalHits: currentCount + 1,
        remaining,
        resetSeconds: windowSeconds,
      };
    } catch {
      // Fail-open if Redis execution encounters an in-flight socket/connection error
      return { allowed: true, totalHits: 1, remaining: limit - 1, resetSeconds: windowSeconds };
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.isConnected) return null;
    try {
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.isConnected) return;
    try {
      if (ttlSeconds) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch {
      // Swallow error during background cache set to prevent unhandled rejection
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }
}
