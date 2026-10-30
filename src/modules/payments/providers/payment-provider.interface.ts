export interface PaymentIntentResult {
  intentId: string;
  clientSecret: string;
  amount: number;
  currency: string;
  status: 'REQUIRES_PAYMENT_METHOD' | 'SUCCEEDED';
  paymentSessionId?: string;
  orderId?: string;
  provider?: string;
}

export interface RefundResult {
  refundId: string;
  amount: number;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
}

export interface IPaymentProvider {
  createIntent(params: {
    amount: number;
    currency: string;
    consultationId: string;
    patientId: string;
    patientEmail?: string;
    patientPhone?: string;
    idempotencyKey?: string;
  }): Promise<PaymentIntentResult>;

  verifyWebhookSignature(payload: string, signature: string, timestamp?: string): boolean;

  refund(params: {
    paymentIntentId: string;
    amount: number;
    reason: string;
    idempotencyKey?: string;
  }): Promise<RefundResult>;

  getOrder?(orderId: string): Promise<Record<string, unknown> | null>;
}
