import { z } from 'zod';

export const CreatePaymentIntentSchema = z.object({
  consultation_id: z.string().uuid(),
});

export type CreatePaymentIntentDto = z.infer<typeof CreatePaymentIntentSchema>;

export const PaymentWebhookPayloadSchema = z.object({
  id: z.string(),
  type: z.enum(['payment_intent.succeeded', 'payment_intent.payment_failed']),
  created: z.number(),
  data: z.object({
    id: z.string(), // provider payment intent id
    amount: z.number().int().positive(),
    currency: z.string().default('INR'),
    metadata: z.object({
      consultation_id: z.string().uuid(),
      patient_id: z.string().uuid(),
    }),
  }),
});

export type PaymentWebhookPayload = z.infer<typeof PaymentWebhookPayloadSchema>;
