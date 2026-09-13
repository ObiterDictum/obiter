import type { LegalSourceType } from '@obiter/legal-schema'
import { z } from 'zod'
import {
  authorityDocumentIdSchema,
  legislationDocumentIdentitySchema,
  legislationLabelPathSchema,
} from './identity'

/**
 * A pointer to public legal source material, traceable enough to open the exact
 * paragraph or provision it names. It carries ids only: never the source text,
 * and never anything from the matter under verification.
 *
 * `sourceType` is deliberately part of the discriminator. The two literals are
 * members of the shared `LegalSourceType` vocabulary, so a rename there fails
 * the typecheck here instead of drifting. Because the union discriminates on
 * source type and each member is strict, a judgment reference cannot carry a
 * legislation label path and a legislation reference cannot carry a paragraph
 * ordinal.
 *
 * Evidence is not source-version aware. The judgment form is the shared
 * `search-client` evidence id, which identifies a paragraph by ordinal, so a
 * re-ingested source document can repoint an ordinal. Verify does not add a
 * second source-version convention here; V5 owns that decision when these
 * become durable rows.
 */
export const evidenceReferenceSchema = z.discriminatedUnion('sourceType', [
  z
    .object({
      sourceType: z.literal('judgment' satisfies LegalSourceType),
      /** The authority document id (`LegalAuthority.id`). */
      sourceId: authorityDocumentIdSchema,
      /**
       * 1-based position in the document's paragraph array. Evidence anchors to
       * position, not to the number the judgment prints: a block-quoted
       * paragraph can carry a printed number that differs from its position.
       */
      ordinal: z.number().int().positive(),
      /** The number a reader is shown, when the paragraph has one. Display only. */
      paragraphNumber: z.number().int().positive().nullable(),
    })
    .strict(),
  z
    .object({
      sourceType: z.literal('legislation_provision' satisfies LegalSourceType),
      /** The Act identity, e.g. `ukpga/2010/15`. */
      sourceId: legislationDocumentIdentitySchema,
      /** The label path within the Act, e.g. `section/40`. */
      labelPath: legislationLabelPathSchema,
    })
    .strict(),
])
export type EvidenceReference = z.infer<typeof evidenceReferenceSchema>

/**
 * The stable id a finding, report or UI key uses for a reference. The judgment
 * form is byte-identical to `createJudgmentParagraphEvidenceId` in
 * `packages/search-client`, which anchors search evidence the same way; the two
 * must not diverge, and the test pins the format. That format is owned by
 * `search-client`, so the `:` join stays and the ambiguity is removed on the
 * other side instead: `sourceId` and `labelPath` are schema-constrained to
 * canonical values that cannot contain `:`, which makes the join injective.
 */
export function createEvidenceReferenceId(
  reference: EvidenceReference,
): string {
  switch (reference.sourceType) {
    case 'judgment':
      return `${reference.sourceId}:judgment_paragraph:${reference.ordinal}`
    case 'legislation_provision':
      return `${reference.sourceId}:legislation_provision:${reference.labelPath}`
  }
}
