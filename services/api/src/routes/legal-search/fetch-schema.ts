import { z } from 'zod'
import { normalizeCourtCode } from './court-utils'

const legalSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/)
  .transform(normalizeCourtCode)

export const legalFetchRequestSchema = z.object({
  query: z.string().trim(),
  court: legalSlugSchema.optional(),
  jurisdiction: legalSlugSchema.optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  foregroundLiveResults: z.boolean().optional(),
})

export type LegalFetchRequest = z.infer<typeof legalFetchRequestSchema>

export const legalDocumentIdSchema = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
