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

export const judgmentPageSchema = z.object({
  pdfPage: z.number().int().positive().optional(),
  page: z.number().int().positive(),
  paragraphNumber: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  paragraphId: z.string().min(1).optional(),
})
export type JudgmentPage = z.infer<typeof judgmentPageSchema>
export const judgmentPaginationSchema = z.object({
  pages: z.array(judgmentPageSchema).optional(),
  pageCount: z.number().int().positive().optional(),
})

export const judgmentHeadingSchema = z.object({
  kind: z.enum(['opinion', 'section']),
  text: z.string().trim().min(1),
})
export type JudgmentHeading = z.infer<typeof judgmentHeadingSchema>

export const judgmentParagraphSchema = z.object({
  id: z.string().min(1),
  paragraphNumber: z.number().int().positive(),
  text: z.string(),
  label: z.string().trim().min(1).optional(),
  level: z.number().int().min(1).max(6).optional(),
  style: z.enum(['quote', 'table']).optional(),
  cells: z.array(z.array(z.string())).optional(),
  headings: z.array(judgmentHeadingSchema).min(1).optional(),
  footnotes: z
    .array(
      z.object({
        marker: z.string().trim().min(1),
        text: z.string().trim().min(1),
        offset: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .optional(),
  images: z
    .array(
      z.object({
        src: z.string().regex(/^[\w-]+(?:\.[\w-]+)*$/),
        offset: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .optional(),
  citations: z
    .array(
      z.object({
        offset: z.number().int().nonnegative(),
        length: z.number().int().positive(),
        type: z.enum(['case', 'legislation']),
        canonical: z.string().optional(),
        href: z
          .string()
          .url()
          .regex(
            /^https:\/\/(?:caselaw\.nationalarchives\.gov\.uk|(?:www\.)?legislation\.gov\.uk)\//,
          )
          .optional(),
      }),
    )
    .min(1)
    .optional(),
})
export type JudgmentParagraph = z.infer<typeof judgmentParagraphSchema>

export const judgmentCoverLineSchema = z.object({
  kind: z.enum([
    'term',
    'citation',
    'appeal',
    'title',
    'label',
    'judge',
    'date',
    'heard',
    'text',
  ]),
  text: z.string().trim().min(1),
  parties: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        role: z.string().trim().min(1).optional(),
      }),
    )
    .min(1)
    .optional(),
})
export type JudgmentCoverLine = z.infer<typeof judgmentCoverLineSchema>

export const judgmentCoverSchema = z.object({
  lines: z.array(judgmentCoverLineSchema).min(1),
  counsel: z.array(z.array(z.string())).min(1).optional(),
})
export type JudgmentCover = z.infer<typeof judgmentCoverSchema>
