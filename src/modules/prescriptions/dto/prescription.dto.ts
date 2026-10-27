import { z } from 'zod';

export const PrescriptionItemSchema = z.object({
  medicine_name: z.string().min(1).max(200),
  dosage: z.string().min(1).max(100),
  frequency: z.string().min(1).max(100),
  duration_days: z.number().int().positive().max(365),
  instructions: z.string().max(500).optional(),
});

export type PrescriptionItem = z.infer<typeof PrescriptionItemSchema>;

export const CreatePrescriptionSchema = z.object({
  consultation_id: z.string().uuid(),
  items: z.array(PrescriptionItemSchema).min(1).max(30),
  instructions: z.string().max(2000).optional(),
});

export type CreatePrescriptionDto = z.infer<typeof CreatePrescriptionSchema>;

export const AmendPrescriptionSchema = z.object({
  items: z.array(PrescriptionItemSchema).min(1).max(30),
  instructions: z.string().max(2000).optional(),
  reason: z.string().min(5).max(500),
});

export type AmendPrescriptionDto = z.infer<typeof AmendPrescriptionSchema>;
