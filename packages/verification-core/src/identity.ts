import { parseLegislationActPath } from '@obiter/contracts'
import { z } from 'zod'

/**
 * The public source identities a resolved citation and an evidence reference
 * both name. Verify compares the two, so both sides must be the same shape and
 * both must be canonical enough to be durable keys.
 */

/**
 * `LegalAuthority.id`: the stored judgment document id. `documentIdFromUri` in
 * `packages/legal-source-provider` produces it by collapsing every non
 * alphanumeric run to `-`, so it is opaque to this package but never contains
 * `:`. The delimiter matters because `createEvidenceReferenceId` joins on it,
 * and a `:` inside a component would make two references collide.
 */
export const authorityDocumentIdSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.includes(':'), {
    message:
      'A judgment document id cannot contain ":"; it delimits evidence ids.',
  })
export type AuthorityDocumentId = z.infer<typeof authorityDocumentIdSchema>

// `ukpga/2010/15`. `packages/contracts/src/legislation-paths.ts` owns this
// grammar; the schema applies it instead of re-parsing.
const LEGISLATION_SEGMENT = /^[A-Za-z0-9._-]+$/

/**
 * True when every `/`-separated segment is a real canonical segment: non-empty,
 * not `.` or `..`, and not percent-encoded or otherwise malformed.
 *
 * The shared grammar is deliberately lenient. It also accepts a bare
 * `ukpga/2010/15` because `apps/web`'s `/ln/$` route hands it the splat after
 * `/ln/`, and it filters empty segments, which lets `..` and `%2e%2e` through.
 * Verify's identities are durable keys, so this package layers the minimum
 * canonical constraint on top rather than tightening a shared parser under
 * existing consumers.
 */
export function isCanonicalLegislationPath(value: string): boolean {
  return value
    .split('/')
    .every(
      (segment) =>
        segment !== '.' &&
        segment !== '..' &&
        LEGISLATION_SEGMENT.test(segment),
    )
}

/** The Act identity, e.g. `ukpga/2010/15`. */
export const legislationDocumentIdentitySchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      isCanonicalLegislationPath(value) &&
      parseLegislationActPath(`/ln/${value}`)?.documentIdentity === value,
    {
      message:
        'A legislation document identity must be the canonical `ukpga/YYYY/N` form.',
    },
  )
export type LegislationDocumentIdentity = z.infer<
  typeof legislationDocumentIdentitySchema
>

/** The label path within the Act, e.g. `section/40`. */
export const legislationLabelPathSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => isCanonicalLegislationPath(value), {
    message:
      'A legislation label path must be `/`-separated, non-empty, non-traversal canonical segments.',
  })
export type LegislationLabelPath = z.infer<typeof legislationLabelPathSchema>
