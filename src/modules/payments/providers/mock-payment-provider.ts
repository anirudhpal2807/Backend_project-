import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { IPaymentProvider, PaymentIntentResult, RefundResult } from './payment-provider.interface';
import { CircuitBreaker } from '../../../common/resilience/circuit-breaker';
import { withRetry } from '../../../common/resilience/retry-backoff';
import { AppConfigService } from '../../../infra/config/config.service';

@Injectable()
export class MockPaymentProvider implements IPaymentProvider {
  private readonly webhookSecret: string;
  private readonly circuitBreaker: CircuitBreaker;

  constructor(private readonly config: AppConfigService) {
    this.webhookSecret = this.config.get('PAYMENT_WEBHOOK_SECRET');
    this.circuitBreaker = new CircuitBreaker('MockPaymentProvider', {
      failureThreshold: 5,
      coolOffDurationMs: 10000,
    });
  }

  public async createIntent(params: {
    amount: number;
    currency: string;
    consultationId: string;
    patientId: string;
    idempotencyKey?: string;
  }): Promise<PaymentIntentResult> {
    return this.circuitBreaker.execute(async () => {
      return withRetry(
        async () => {
          const intentId = `pi_${crypto.randomBytes(12).toString('hex')}`;
          const clientSecret = `${intentId}_secret_${crypto.randomBytes(16).toString('hex')}`;

          return {
            intentId,
            clientSecret,
            amount: params.amount,
            currency: params.currency,
            status: 'REQUIRES_PAYMENT_METHOD',
          };
        },
        { maxAttempts: 3, baseBackoffMs: 100 },
      );
    });
  }

  public verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!signature) {
      return false;
    }

    try {
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(payload)
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex'),
      );
    } catch {
      return false;
    }
  }

  public generateWebhookSignature(payload: string): string {
    return crypto.createHmac('sha256', this.webhookSecret).update(payload).digest('hex');
  }

  public async refund(params: {
    paymentIntentId: string;
    amount: number;
    reason: string;
    idempotencyKey?: string;
  }): Promise<RefundResult> {
    return this.circuitBreaker.execute(async () => {
      return withRetry(
        async () => {
          const refundId = `re_${crypto.randomBytes(12).toString('hex')}`;
          return {
            refundId,
            amount: params.amount,
            status: 'SUCCEEDED',
          };
        },
        { maxAttempts: 3, baseBackoffMs: 100 },
      );
    });
  }
}
