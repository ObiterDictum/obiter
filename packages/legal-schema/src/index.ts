import { z } from 'zod'

export const LegalSourceTypeSchema = z.enum(['judgment'])
export type LegalSourceType = z.infer<typeof LegalSourceTypeSchema>

export const LegalParagraphSchema = z.object({
  id: z.string().trim().min(1),
  documentId: z.string().trim().min(1),
  paragraphNumber: z.number().int().positive(),
  text: z.string().trim().min(1),
})
export type LegalParagraph = z.infer<typeof LegalParagraphSchema>

export const LegalAuthoritySchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  neutralCitation: z.string().trim().min(1),
  court: z.string().trim().min(1),
  jurisdiction: z.string().trim().min(1),
  dateDecided: z.string().date(),
  sourceType: LegalSourceTypeSchema,
  sourceUrl: z.string().url(),
  paragraphs: z.array(LegalParagraphSchema).optional(),
})
export type LegalAuthority = z.infer<typeof LegalAuthoritySchema>

export const LegalAuthoritySummarySchema = LegalAuthoritySchema.omit({
  paragraphs: true,
})
export type LegalAuthoritySummary = z.infer<typeof LegalAuthoritySummarySchema>

export const legalAuthoritiesSchema = z.array(LegalAuthoritySchema)
