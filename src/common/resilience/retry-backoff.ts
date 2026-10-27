export interface RetryOptions {
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  shouldRetry?: (error: unknown) => boolean;
  sleepFn?: (ms: number) => Promise<void>;
}

export function calculateFullJitterBackoff(attempt: number, baseMs = 100, maxMs = 10000): number {
  const exponentialCap = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  // Full jitter: uniformly random between 0 and exponentialCap
  return Math.floor(Math.random() * exponentialCap);
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseBackoffMs = options.baseBackoffMs ?? 100;
  const maxBackoffMs = options.maxBackoffMs ?? 10000;
  const shouldRetry = options.shouldRetry ?? (() => true);
  const sleep =
    options.sleepFn ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;

      if (attempt >= maxAttempts || !shouldRetry(error)) {
        throw error;
      }

      const backoffMs = calculateFullJitterBackoff(attempt, baseBackoffMs, maxBackoffMs);
      await sleep(backoffMs);
    }
  }

  throw lastError;
}
