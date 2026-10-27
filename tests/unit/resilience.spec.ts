import { withRetry, calculateFullJitterBackoff } from '../../src/common/resilience/retry-backoff';
import { CircuitBreaker } from '../../src/common/resilience/circuit-breaker';
import { withTimeout } from '../../src/common/resilience/timeout';
import { ErrorCode } from '../../src/common/errors/error-codes';
import { AppException } from '../../src/common/errors/app-exception';

describe('Resilience Utilities (T-037)', () => {
  describe('Full Jitter Backoff', () => {
    it('calculates jittered delay bounded between 0 and exponential cap', () => {
      for (let i = 0; i < 20; i++) {
        const delay = calculateFullJitterBackoff(2, 100, 1000);
        // attempt 2: base 100 * 2^2 = 400
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(400);
      }
    });
  });

  describe('withRetry', () => {
    it('retries failed operation with backoff and succeeds when operation eventually recovers', async () => {
      let attempts = 0;
      const sleepMock = jest.fn().mockResolvedValue(undefined);

      const result = await withRetry(
        async attempt => {
          attempts = attempt;
          if (attempt < 3) {
            throw new Error('transient error');
          }
          return 'recovered';
        },
        { maxAttempts: 3, sleepFn: sleepMock },
      );

      expect(result).toBe('recovered');
      expect(attempts).toBe(3);
      expect(sleepMock).toHaveBeenCalledTimes(2);
    });

    it('stops retrying immediately when maxAttempts is exceeded', async () => {
      const sleepMock = jest.fn().mockResolvedValue(undefined);

      await expect(
        withRetry(
          async () => {
            throw new Error('permanent failure');
          },
          { maxAttempts: 2, sleepFn: sleepMock },
        ),
      ).rejects.toThrow('permanent failure');

      expect(sleepMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('CircuitBreaker', () => {
    it('trips from CLOSED to OPEN after reaching failureThreshold', async () => {
      const breaker = new CircuitBreaker('PaymentMock', {
        failureThreshold: 3,
        coolOffDurationMs: 500,
      });

      const failingOp = async () => {
        throw new Error('provider down');
      };

      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(failingOp)).rejects.toThrow('provider down');
      }

      expect(breaker.getState()).toBe('OPEN');

      // Subsequent call must fail immediately without invoking the operation
      try {
        await breaker.execute(async () => 'should not be called');
        fail('Expected circuit breaker to block request');
      } catch (err) {
        const appEx = err as AppException;
        expect(appEx.code).toBe(ErrorCode.CIRCUIT_OPEN);
      }
    });
  });

  describe('withTimeout', () => {
    it('resolves normally if promise finishes before timeout', async () => {
      const fastPromise = Promise.resolve('fast');
      const result = await withTimeout(fastPromise, 100);
      expect(result).toBe('fast');
    });

    it('rejects with timeout exception if promise takes longer than timeout limit', async () => {
      const slowPromise = new Promise(resolve => setTimeout(resolve, 50));
      await expect(withTimeout(slowPromise, 10, 'TestSlow')).rejects.toThrow(
        /TestSlow timed out after 10ms/,
      );
    });
  });
});
