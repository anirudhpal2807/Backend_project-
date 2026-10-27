import { Injectable } from '@nestjs/common';

export type IdempotencyRecordStatus = 'IN_FLIGHT' | 'COMPLETED' | 'FAILED';

export interface IdempotencyRecord {
  key: string;
  scope: string;
  userId?: string;
  requestFingerprint: string;
  status: IdempotencyRecordStatus;
  responseStatus?: number;
  responseBody?: string;
  responseHeaders?: Record<string, string>;
  expiresAt: Date;
  createdAt: Date;
}

export interface AcquireResult {
  acquired: boolean;
  record?: IdempotencyRecord;
}

@Injectable()
export class IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  private buildLookupKey(scope: string, key: string, userId?: string): string {
    return `${scope}:${userId || 'anonymous'}:${key}`;
  }

  async acquire(
    key: string,
    scope: string,
    fingerprint: string,
    userId?: string,
    ttlSeconds = 86400, // 24 hours
  ): Promise<AcquireResult> {
    const lookupKey = this.buildLookupKey(scope, key, userId);
    const existing = this.records.get(lookupKey);

    const now = new Date();

    if (existing) {
      if (existing.expiresAt.getTime() <= now.getTime()) {
        // Expired, delete and allow re-acquire
        this.records.delete(lookupKey);
      } else {
        return { acquired: false, record: existing };
      }
    }

    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const newRecord: IdempotencyRecord = {
      key,
      scope,
      userId,
      requestFingerprint: fingerprint,
      status: 'IN_FLIGHT',
      expiresAt,
      createdAt: now,
    };

    this.records.set(lookupKey, newRecord);
    return { acquired: true, record: newRecord };
  }

  async saveResponse(
    key: string,
    scope: string,
    statusCode: number,
    body: string,
    userId?: string,
    headers: Record<string, string> = {},
  ): Promise<void> {
    const lookupKey = this.buildLookupKey(scope, key, userId);
    const record = this.records.get(lookupKey);
    if (record) {
      record.status = 'COMPLETED';
      record.responseStatus = statusCode;
      record.responseBody = body;
      record.responseHeaders = headers;
    }
  }

  async markFailed(key: string, scope: string, userId?: string): Promise<void> {
    const lookupKey = this.buildLookupKey(scope, key, userId);
    const record = this.records.get(lookupKey);
    if (record) {
      record.status = 'FAILED';
    }
  }

  // Purge expired keys (TTL maintenance)
  purgeExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [key, record] of this.records.entries()) {
      if (record.expiresAt.getTime() <= now) {
        this.records.delete(key);
        count++;
      }
    }
    return count;
  }
}
