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

/**
 * A citation as it appears in the draft, with where it appears. `rawText` is
 * the citation string only, never the paragraph around it, and it is stored
 * verbatim: it is the draft slice over `[location.start, location.end)`, so a
 * caller can re-read the same characters from the projection the location
 * names. The span is measured in UTF-16 code units, and the schema ties the two
 * together rather than trimming `rawText` away from its span.
 */
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

/**
 * Why a citation could not be reduced to a source identity. Normalisation
 * failing is not a finding on its own; it forces a check to `review_required`
 * rather than a pass. The reasons are the distinct ways normalisation can
 * fail, so an operational caller can tell them apart without reading the
 * finding explanation:
 *
 * - `not_a_citation`: the input is outside the accepted citation grammar.
 * - `ambiguous`: the input names more than one canonical authority.
 * - `unsupported_source_type`: the input is a citation of a source family
 *   Verify does not resolve.
 * - `no_canonical_match`: the input is citation-shaped and inside the grammar,
 *   but no canonical identity could be established for it. It is not proof the
 *   authority is absent; that is the authority-existence check's question.
 * - `resolution_unavailable`: resolution could not complete because an
 *   operational dependency failed. This is not a negative result, and it must
 *   not be read as one.
 */
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

/**
 * The identity a check acts on, in both directions:
 *
 * - `case_law`: a resolved authority. The neutral citation is the canonical
 *   printed string, and `sourceId` is the stored authority document id
 *   (`LegalAuthority.id`) that evidence references also use. Splitting a neutral
 *   citation into court, year and number is citation resolution, which V3 owns;
 *   the string stays whole here. Carrying `sourceId` is what lets a finding
 *   check that its evidence names the same authority.
 * - `legislation`: the canonical Act identity plus the label path within the
 *   Act, with `null` meaning the whole Act.
 * - `unresolved`: normalisation ran and could not produce an identity, for a
 *   conservative reason.
 * - `not_checked`: normalisation has not run, so the citation has no identity
 *   yet. It is the only citation state that pairs with an unrun check.
 */
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

/**
 * The only normalisation this package owns: a canonical legislation path
 * (`/ln/...`, which a solicitor pastes) to its source identity. It delegates to
 * the shared path grammar in `packages/contracts/src/legislation-paths.ts`
 * rather than re-parsing it, because that grammar and this function must not
 * drift. It adds the canonical constraints that make an identity a durable key:
 * the `/ln/` prefix is required, and empty, `.`/`..` and percent-encoded
 * segments are refused (see `isCanonicalLegislationPath`).
 *
 * Null covers two different failures a caller may need to separate: a path that
 * is not canonical at all, and a canonical-shaped path naming an act type this
 * repository does not store. Resolution tells them apart with
 * `isSupportedLegislationActType`, so this function stays a parser and does not
 * guess at the caller's policy.
 *
 * Free-text legislation citations (`s 6 HRA 1998`) are recognised by search, in
 * `services/api/src/routes/legal-search/legislation-citations.ts`, against a
 * stored Act directory. That is resolution and it stays out of this layer.
 * Case citations are not normalised here either; V3 owns it.
 */
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
