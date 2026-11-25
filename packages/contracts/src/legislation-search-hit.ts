import { z } from 'zod'
import { legalSearchCitationMatchSchema } from './legal-search'
import { legislationStatusSchema } from './legislation-reader'

export const legislationActStatusSchema = z.enum(['in_force', 'repealed'])
export const legislationActSummarySchema = z.object({
  status: legislationActStatusSchema,
  repealedFrom: z.string().optional(),
  enactmentDate: z.string().optional(),
  totalCount: z.int().nonnegative(),
  withheldCount: z.int().nonnegative(),
  outline: z.array(z.string()).max(4),
})
export type LegislationActSummary = z.infer<typeof legislationActSummarySchema>

export const legislationSearchHitSchema = z.object({
  id: z.string(),
  resultGroup: z.literal('legislation'),
  legislationStatus: legislationStatusSchema,
  repealedFrom: z.string().optional(),
  title: z.string(),
  year: z.number().optional(),
  provisionLabel: z.string(),
  labelPath: z.string(),
  documentIdentity: z.string(),
  extent: z.string(),
  canonicalUrl: z.string().optional(),
  text: z.string().optional(),
  snippets: z.array(z.object({ text: z.string() })).optional(),
  officialUrl: z.string(),
  sourceUrl: z.string(),
  effectsCheckedAt: z.string().optional(),
  notice: z.string().optional(),
  citationMatch: legalSearchCitationMatchSchema.optional(),
  retrievalPath: z
    .enum([
      'stored_exact_lookup',
      'stored_index',
      'stored_source',
      'live_provider',
    ])
    .optional(),
  retrievalRank: z.number().optional(),
  act: legislationActSummarySchema.optional(),
})
export type LegislationSearchHit = z.infer<typeof legislationSearchHitSchema>
