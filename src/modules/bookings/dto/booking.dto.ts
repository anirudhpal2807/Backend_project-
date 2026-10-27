import { z } from 'zod';

export const CreateBookingHoldSchema = z.object({
  slot_id: z.string().uuid(),
  notes: z.string().max(500).optional(),
});

export type CreateBookingHoldDto = z.infer<typeof CreateBookingHoldSchema>;

export const CancelBookingSchema = z.object({
  reason: z.string().min(3).max(500),
});

export type CancelBookingDto = z.infer<typeof CancelBookingSchema>;
