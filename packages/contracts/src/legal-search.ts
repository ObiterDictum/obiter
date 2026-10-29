import { z } from 'zod'

export const legalSearchCitationStatusSchema = z.enum([
  'held_exact',
  'not_held',
  'not_citation',
  'unverified',
])
export type LegalSearchCitationStatus = z.infer<
  typeof legalSearchCitationStatusSchema
>

export const legalSearchCitationSchema = z.object({
  recognised: z.boolean(),
  status: legalSearchCitationStatusSchema,
})
export type LegalSearchCitation = z.infer<typeof legalSearchCitationSchema>

export const legalSearchCitationMatchSchema = z.enum([
  'exact',
  'citing',
  'none',
])
export type LegalSearchCitationMatch = z.infer<
  typeof legalSearchCitationMatchSchema
>

export const legalFetchOutcomeSchema = z.enum([
  'results',
  'no_match',
  'hydration_queued',
  'stored_browse_empty',
  'unsupported_source_type',
  'recognised_not_held',
  'legislation_title_unresolved',
  'legislation_ambiguous',
  'legislation_schedule_underspecified',
])
export type LegalFetchOutcome = z.infer<typeof legalFetchOutcomeSchema>

export const legislationScheduleGuidanceSchema = z.object({
  example: z.string().nullable(),
  actTitle: z.string(),
})
export type LegislationScheduleGuidance = z.infer<
  typeof legislationScheduleGuidanceSchema
>

export const caseLawSummaryResponseSchema = z.object({
  kind: z.literal('press_summary'),
  paragraphs: z.array(z.string().trim().min(1)).min(1),
  sourceUrl: z.string().url(),
})
export type CaseLawSummaryResponse = z.infer<
  typeof caseLawSummaryResponseSchema
>
