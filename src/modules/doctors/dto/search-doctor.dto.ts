import { z } from 'zod';

export const SearchDoctorQuerySchema = z.object({
  q: z.string().max(100).optional(),
  specialization: z.string().max(100).optional(),
  language: z.string().max(50).optional(),
  gender: z.string().max(20).optional(),
  min_fee: z.coerce.number().int().nonnegative().optional(),
  max_fee: z.coerce.number().int().positive().optional(),
  min_experience: z.coerce.number().int().nonnegative().optional(),
  available_from: z.string().datetime().optional(),
  available_to: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20).optional(),
});

export type SearchDoctorQueryDto = z.input<typeof SearchDoctorQuerySchema>;
