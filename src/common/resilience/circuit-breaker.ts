import { HttpStatus } from '@nestjs/common';
import { AppException } from '../errors/app-exception';
import { ErrorCode } from '../errors/error-codes';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  coolOffDurationMs?: number;
  successThreshold?: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private nextAttemptTime = 0;

  private readonly failureThreshold: number;
  private readonly coolOffDurationMs: number;
  private readonly successThreshold: number;

  constructor(
    private readonly name: string,
    options: CircuitBreakerOptions = {},
  ) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.coolOffDurationMs = options.coolOffDurationMs ?? 10000;
    this.successThreshold = options.successThreshold ?? 2;
  }

  getState(): CircuitState {
    const now = Date.now();
    if (this.state === 'OPEN' && now >= this.nextAttemptTime) {
      this.state = 'HALF_OPEN';
    }
    return this.state;
  }

  async execute<T>(action: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === 'OPEN') {
      const retryAfterSec = Math.ceil((this.nextAttemptTime - Date.now()) / 1000);
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.CIRCUIT_OPEN,
        `Circuit breaker for service '${this.name}' is OPEN. Requests blocked temporarily.`,
        undefined,
        Math.max(1, retryAfterSec),
      );
    }

    try {
      const result = await action();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.successCount = 0;
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttemptTime = Date.now() + this.coolOffDurationMs;
    }
  }

  // Testing & inspection helper
  forceOpen(coolOffMs = 10000): void {
    this.state = 'OPEN';
    this.nextAttemptTime = Date.now() + coolOffMs;
  }

  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptTime = 0;
  }
}
