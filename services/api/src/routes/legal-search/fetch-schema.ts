import { z } from 'zod'
import {
  LegalSourceFamilySchema,
  LegalSourceTypeSchema,
} from '@obiter/legal-schema'
import { normalizeCourtCode } from './court-utils'

const legalSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/)
  .transform(normalizeCourtCode)

export const legalFetchRequestSchema = z.object({
  query: z.string().trim(),
  sourceType: LegalSourceTypeSchema.optional(),
  sourceFamily: LegalSourceFamilySchema.optional(),
  court: legalSlugSchema.optional(),
  jurisdiction: legalSlugSchema.optional(),
  legalDomain: legalSlugSchema.optional(),
  provider: legalSlugSchema.optional(),
  topic: z.string().trim().min(1).max(120).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  asAtDate: z.string().date().optional(),
  legislationVersion: z.string().trim().min(1).max(80).optional(),
  foregroundLiveResults: z.boolean().optional(),
})

export type LegalFetchRequest = z.infer<typeof legalFetchRequestSchema>

export const legalDocumentIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
