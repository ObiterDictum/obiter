import {
  parseLegislationActPath,
  parseLegislationProvisionPath,
} from '@obiter/contracts'
import { z } from 'zod'
import { draftLocationSchema } from './subject'

/**
 * A citation as it appears in the draft, with where it appears. `rawText` is
 * the citation string only, never the paragraph around it. The location makes
 * the citation traceable back to the draft without copying draft text into the
 * finding.
 */
export const citationInputSchema = z
  .object({
    rawText: z.string().trim().min(1),
    location: draftLocationSchema,
  })
  .strict()
export type CitationInput = z.infer<typeof citationInputSchema>

/**
 * Why a citation could not be reduced to a source identity. Normalisation
 * failing is not a finding on its own; it forces a check to `review_required`
 * rather than a pass.
 */
export const citationUnresolvedReasonSchema = z.enum([
  'not_a_citation',
  'ambiguous',
  'unsupported_source_type',
])
export type CitationUnresolvedReason = z.infer<
  typeof citationUnresolvedReasonSchema
>

/**
 * The identity a check acts on. Case citations stay a single canonical string:
 * splitting a neutral citation into court, year and number is citation
 * resolution, which V3 owns, and no spec defines that decomposition yet.
 * Legislation is its Act identity plus the label path within the Act, with
 * `null` meaning the whole Act.
 */
export const normalizedCitationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('case_law'),
      neutralCitation: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('legislation'),
      documentIdentity: z.string().trim().min(1),
      labelPath: z.string().trim().min(1).nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('unresolved'),
      reason: citationUnresolvedReasonSchema,
    })
    .strict(),
])
export type NormalizedCitation = z.infer<typeof normalizedCitationSchema>

/**
 * The only normalisation this package owns: a canonical legislation path
 * (`/ln/...`, which a solicitor pastes) to its source identity. It delegates to
 * the shared path grammar in `packages/contracts/src/legislation-paths.ts`
 * rather than re-parsing it, because that grammar and this function must not
 * drift.
 *
 * Free-text legislation citations (`s 6 HRA 1998`) are recognised by search, in
 * `services/api/src/routes/legal-search/legislation-citations.ts`, against a
 * stored Act directory. That is resolution and it stays out of this layer.
 * Case citations are not normalised here either; V3 owns it.
 */
export function normalizeLegislationCitationPath(
  path: string,
): NormalizedCitation | null {
  const provision = parseLegislationProvisionPath(path)
  if (provision) {
    return {
      kind: 'legislation',
      documentIdentity: provision.documentIdentity,
      labelPath: provision.labelPath,
    }
  }
  const act = parseLegislationActPath(path)
  if (act) {
    return {
      kind: 'legislation',
      documentIdentity: act.documentIdentity,
      labelPath: null,
    }
  }
  return null
}
