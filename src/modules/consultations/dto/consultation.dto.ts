import { z } from 'zod';

export const UpdateClinicalNotesSchema = z.object({
  notes: z.string().min(1).max(10000),
  version: z.number().int().nonnegative(),
});

export type UpdateClinicalNotesDto = z.infer<typeof UpdateClinicalNotesSchema>;

export const CompleteConsultationSchema = z.object({
  summary: z.string().max(2000).optional(),
});

export type CompleteConsultationDto = z.infer<typeof CompleteConsultationSchema>;
