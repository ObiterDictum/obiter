import { z } from 'zod'
import { legislationActTextPageSize } from './legislation-reader'

export const legislationActTextQuerySchema = z.object({
  offset: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.int().min(0).max(2_147_483_647))
    .default(0),
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.int().min(1).max(50))
    .default(legislationActTextPageSize),
})
export type LegislationActTextQuery = z.infer<
  typeof legislationActTextQuerySchema
>
