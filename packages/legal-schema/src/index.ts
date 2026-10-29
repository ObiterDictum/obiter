import { z } from 'zod'

export const LegalSourceTypeSchema = z.enum([
  'judgment',
  'legislation_document',
  'legislation_provision',
  'international_instrument',
  'international_decision',
  'guidance',
  'other',
])
export type LegalSourceType = z.infer<typeof LegalSourceTypeSchema>

export const LegalSourceFamilySchema = z.enum([
  'case_law',
  'legislation',
  'international_law',
  'guidance',
  'other',
])
export type LegalSourceFamily = z.infer<typeof LegalSourceFamilySchema>

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
  neutralCitation: z.string().trim().min(1).nullable(),
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

/**
 * Where a value stored beside a judgment came from. `fcl_metadata` is a field
 * Find Case Law publishes as structured metadata; `extracted` is reserved for
 * a licensed extractor that derives it from the text, so a reader can always
 * tell which rows were read and which were derived.
 */
export const CaseLawMetadataSourceSchema = z.enum(['fcl_metadata', 'extracted'])
export type CaseLawMetadataSource = z.infer<typeof CaseLawMetadataSourceSchema>

/** One member of the bench, with the field it was read from. */
export const CaseLawJudgeSchema = z.object({
  name: z.string().trim().min(1),
  source: CaseLawMetadataSourceSchema,
  field: z.string().trim().min(1),
})
export type CaseLawJudge = z.infer<typeof CaseLawJudgeSchema>

/**
 * The court's own published summary, quoted whole, with the field it was read
 * from and the page it was quoted from.
 */
export const CaseLawSummarySchema = z.object({
  paragraphs: z.array(z.string().trim().min(1)).min(1),
  source: CaseLawMetadataSourceSchema,
  field: z.string().trim().min(1),
  sourceUrl: z.string().url(),
})
export type CaseLawSummary = z.infer<typeof CaseLawSummarySchema>

export const legalAuthoritiesSchema = z.array(LegalAuthoritySchema)
