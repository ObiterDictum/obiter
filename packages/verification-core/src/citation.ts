import {
  parseLegislationActPath,
  parseLegislationProvisionPath,
} from '@obiter/contracts'
import { z } from 'zod'
import {
  authorityDocumentIdSchema,
  isCanonicalLegislationPath,
  legislationDocumentIdentitySchema,
  legislationLabelPathSchema,
} from './identity'
import { draftLocationSchema } from './subject'

export const citationInputSchema = z
  .object({
    rawText: z.string().refine((value) => value.trim().length > 0, {
      message: 'A citation cannot be blank.',
    }),
    location: draftLocationSchema,
  })
  .strict()
  .refine(
    (citation) =>
      citation.rawText.length ===
      citation.location.end - citation.location.start,
    {
      message:
        'rawText must be the draft slice the location names: its UTF-16 length must equal end - start.',
      path: ['location'],
    },
  )
export type CitationInput = z.infer<typeof citationInputSchema>

export const citationUnresolvedReasonSchema = z.enum([
  'not_a_citation',
  'ambiguous',
  'unsupported_source_type',
  'no_canonical_match',
  'resolution_unavailable',
])
export type CitationUnresolvedReason = z.infer<
  typeof citationUnresolvedReasonSchema
>

export const normalizedCitationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('case_law'),
      neutralCitation: z.string().trim().min(1),
      sourceId: authorityDocumentIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('legislation'),
      documentIdentity: legislationDocumentIdentitySchema,
      labelPath: legislationLabelPathSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('unresolved'),
      reason: citationUnresolvedReasonSchema,
    })
    .strict(),
  z.object({ kind: z.literal('not_checked') }).strict(),
])
export type NormalizedCitation = z.infer<typeof normalizedCitationSchema>

export function normalizeLegislationCitationPath(
  path: string,
): Extract<NormalizedCitation, { kind: 'legislation' }> | null {
  if (!path.startsWith('/ln/')) return null
  const rest = path.slice('/ln/'.length)
  if (!isCanonicalLegislationPath(rest)) return null

  const provision = parseLegislationProvisionPath(rest)
  if (provision) {
    return {
      kind: 'legislation',
      documentIdentity: provision.documentIdentity,
      labelPath: provision.labelPath,
    }
  }
  const act = parseLegislationActPath(rest)
  if (act) {
    return {
      kind: 'legislation',
      documentIdentity: act.documentIdentity,
      labelPath: null,
    }
  }
  return null
}
