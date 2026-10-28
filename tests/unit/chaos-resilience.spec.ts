import { RedisService } from '../../src/infra/redis/redis.service';
import { AppConfigService } from '../../src/infra/config/config.service';
import { CircuitBreaker } from '../../src/common/resilience/circuit-breaker';
import { withRetry } from '../../src/common/resilience/retry-backoff';
import { AppException } from '../../src/common/errors/app-exception';
import { ErrorCode } from '../../src/common/errors/error-codes';
import { OutboxService } from '../../src/infra/queue/outbox.service';
import { DatabaseService } from '../../src/infra/db/database.service';

describe('Chaos & Resilience Test Suite (T-133)', () => {
  describe('Redis Outage & Graceful Degradation', () => {
    let redisService: RedisService;
    let mockConfig: jest.Mocked<AppConfigService>;

    beforeEach(() => {
      mockConfig = {
        get: jest.fn((key: string) => {
          if (key === 'REDIS_HOST') return 'localhost';
          if (key === 'REDIS_PORT') return 6379;
          return undefined;
        }),
      } as unknown as jest.Mocked<AppConfigService>;

      redisService = new RedisService(mockConfig);
    });

    it('rate limiter fails-open when Redis is disconnected', async () => {
      // isConnected is false by default before connection event
      const res = await redisService.checkRateLimit('user_test_ip', 10, 60);

      expect(res.allowed).toBe(true);
      expect(res.totalHits).toBe(1);
      expect(res.remaining).toBe(9);
    });

    it('rate limiter fails-open when Redis throws an in-flight socket error', async () => {
      // Force connected state but mock client.multi to throw
      (redisService as unknown as { isConnected: boolean }).isConnected = true;
      (redisService as unknown as { client: unknown }).client = {
        multi: jest.fn().mockReturnValue({
          zremrangebyscore: jest.fn().mockReturnThis(),
          zcard: jest.fn().mockReturnThis(),
          zadd: jest.fn().mockReturnThis(),
          expire: jest.fn().mockReturnThis(),
          exec: jest.fn().mockRejectedValue(new Error('ECONNRESET: Connection reset by peer')),
        }),
      };

      const res = await redisService.checkRateLimit('user_test_ip', 10, 60);

      expect(res.allowed).toBe(true);
      expect(res.totalHits).toBe(1);
    });

    it('redis cache-aside get returns null gracefully on connection drop', async () => {
      (redisService as unknown as { isConnected: boolean }).isConnected = true;
      (redisService as unknown as { client: unknown }).client = {
        get: jest.fn().mockRejectedValue(new Error('Cluster node unreachable')),
      };

      const val = await redisService.get('doctors_search:key');
      expect(val).toBeNull();
    });

    it('redis cache-aside set suppresses errors when Redis write drops', async () => {
      (redisService as unknown as { isConnected: boolean }).isConnected = true;
      (redisService as unknown as { client: unknown }).client = {
        set: jest.fn().mockRejectedValue(new Error('READONLY You cannot write to a replica')),
      };

      await expect(redisService.set('key', 'val', 60)).resolves.toBeUndefined();
    });
  });

  describe('Database Failover & Deadlock Retries', () => {
    it('retries and succeeds when transient deadlock (40P01) occurs', async () => {
      let callCount = 0;
      const sleepFn = jest.fn().mockResolvedValue(undefined);

      const operation = async () => {
        callCount++;
        if (callCount === 1) {
          const err = new Error('deadlock detected') as Error & { code?: string };
          err.code = '40P01';
          throw err;
        }
        return { committed: true };
      };

      const result = await withRetry(operation, {
        maxAttempts: 3,
        baseBackoffMs: 10,
        sleepFn,
      });

      expect(result).toEqual({ committed: true });
      expect(callCount).toBe(2);
      expect(sleepFn).toHaveBeenCalledTimes(1);
    });

    it('retries and succeeds when serialization failure (40001) occurs during concurrent tx', async () => {
      let attempts = 0;
      const sleepFn = jest.fn().mockResolvedValue(undefined);

      const res = await withRetry(
        async () => {
          attempts++;
          if (attempts < 3) {
            const err = new Error(
              'could not serialize access due to concurrent update',
            ) as Error & { code?: string };
            err.code = '40001';
            throw err;
          }
          return 'ok';
        },
        { maxAttempts: 4, sleepFn },
      );

      expect(res).toBe('ok');
      expect(attempts).toBe(3);
    });
  });

  describe('Provider Outage & Circuit Breaker', () => {
    it('fast-fails downstream calls with 503 SERVICE_UNAVAILABLE once threshold is exceeded', async () => {
      const breaker = new CircuitBreaker('DailyCoMock', {
        failureThreshold: 2,
        coolOffDurationMs: 1000,
        successThreshold: 1,
      });

      // 1. First failure
      await expect(
        breaker.execute(async () => {
          throw new Error('502 Bad Gateway from Daily.co');
        }),
      ).rejects.toThrow('502 Bad Gateway from Daily.co');

      expect(breaker.getState()).toBe('CLOSED');

      // 2. Second failure triggers OPEN
      await expect(
        breaker.execute(async () => {
          throw new Error('504 Gateway Timeout from Daily.co');
        }),
      ).rejects.toThrow('504 Gateway Timeout from Daily.co');

      expect(breaker.getState()).toBe('OPEN');

      // 3. Third call immediately fast-fails without executing downstream action
      const downstreamSpy = jest.fn();
      await expect(breaker.execute(downstreamSpy)).rejects.toThrow(AppException);

      try {
        await breaker.execute(downstreamSpy);
      } catch (e) {
        const appErr = e as AppException;
        expect(appErr.code).toBe(ErrorCode.CIRCUIT_OPEN);
        expect(appErr.getStatus()).toBe(503);
      }

      expect(downstreamSpy).not.toHaveBeenCalled();
    });
  });

  describe('Worker Job Failure & Dead Letter Handling', () => {
    let outboxService: OutboxService;
    let mockDbService: jest.Mocked<DatabaseService>;

    beforeEach(() => {
      mockDbService = {} as unknown as jest.Mocked<DatabaseService>;
      outboxService = new OutboxService(mockDbService);
    });

    it('marks event as FAILED when retries reach 5 threshold', async () => {
      const setMock = jest.fn().mockReturnThis();
      const whereMock = jest.fn().mockReturnThis();
      const executeMock = jest.fn().mockResolvedValue(undefined);

      const fakeDb = {
        selectFrom: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              executeTakeFirst: jest.fn().mockResolvedValue({ retry_count: 4 }),
            }),
          }),
        }),
        updateTable: jest.fn().mockReturnValue({
          set: setMock,
          where: whereMock,
          execute: executeMock,
        }),
      };
      Object.defineProperty(mockDbService, 'db', { value: fakeDb, writable: true });

      // Mark failure for an event that currently has retry_count 4 -> reaches 5 -> status 'FAILED'
      await outboxService.markFailed('evt_123');

      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FAILED',
          retry_count: 5,
        }),
      );
    });

    it('increments retry count and sets status to PENDING when retries remain below 5', async () => {
      const setMock = jest.fn().mockReturnThis();
      const whereMock = jest.fn().mockReturnThis();
      const executeMock = jest.fn().mockResolvedValue(undefined);

      const fakeDb = {
        selectFrom: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              executeTakeFirst: jest.fn().mockResolvedValue({ retry_count: 1 }),
            }),
          }),
        }),
        updateTable: jest.fn().mockReturnValue({
          set: setMock,
          where: whereMock,
          execute: executeMock,
        }),
      };
      Object.defineProperty(mockDbService, 'db', { value: fakeDb, writable: true });

      await outboxService.markFailed('evt_456');

      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'PENDING',
          retry_count: 2,
        }),
      );
    });
  });
});
