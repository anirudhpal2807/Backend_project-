export interface PaymentIntentResult {
  intentId: string;
  clientSecret: string;
  amount: number;
  currency: string;
  status: 'REQUIRES_PAYMENT_METHOD' | 'SUCCEEDED';
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
    idempotencyKey?: string;
  }): Promise<PaymentIntentResult>;

  verifyWebhookSignature(payload: string, signature: string): boolean;

  refund(params: {
    paymentIntentId: string;
    amount: number;
    reason: string;
    idempotencyKey?: string;
  }): Promise<RefundResult>;
}
