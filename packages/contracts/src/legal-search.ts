import { z } from 'zod'

/**
 * Citation honesty for exact-lookup queries. A query the proxy recognises as
 * a neutral citation or document id is either held exactly, recognised but
 * not held, or not a citation at all. Additive: every member is optional at
 * the response boundary, so older clients keep reading.
 */
export const legalSearchCitationStatusSchema = z.enum([
  'held_exact',
  'not_held',
  'not_citation',
])
export type LegalSearchCitationStatus = z.infer<
  typeof legalSearchCitationStatusSchema
>

export const legalSearchCitationSchema = z.object({
  recognised: z.boolean(),
  status: legalSearchCitationStatusSchema,
})
export type LegalSearchCitation = z.infer<typeof legalSearchCitationSchema>

/**
 * Per-hit relation to the recognised citation. `exact` is the held judgment
 * itself, `citing` mentions the citation in its body, `none` is neither.
 * Labels only: honesty gates read the match tier, never this field.
 */
export const legalSearchCitationMatchSchema = z.enum([
  'exact',
  'citing',
  'none',
])
export type LegalSearchCitationMatch = z.infer<
  typeof legalSearchCitationMatchSchema
>

/**
 * Fetch outcomes including the honest empty: the citation is well formed but
 * no source holds it. Existing members are unchanged.
 */
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

/**
 * Structured corrective for a schedule citation that names a paragraph but no
 * schedule. `example` is built from the citation's own label path, so it is a
 * citation the parser accepts and cannot drift from it; `actTitle` retains the
 * Act context needed to resubmit the example.
 */
export const legislationScheduleGuidanceSchema = z.object({
  example: z.string().nullable(),
  actTitle: z.string(),
})
export type LegislationScheduleGuidance = z.infer<
  typeof legislationScheduleGuidanceSchema
>
