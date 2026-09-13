import type { LegalSourceType } from '@obiter/legal-schema'
import { z } from 'zod'

/**
 * A pointer to public legal source material, traceable enough to open the exact
 * paragraph or provision it names. It carries ids only: never the source text,
 * and never anything from the matter under verification.
 *
 * `sourceType` is deliberately part of the discriminator. The two literals are
 * members of the shared `LegalSourceType` vocabulary, so a rename there fails
 * the typecheck here instead of drifting.
 */
export const evidenceReferenceSchema = z.discriminatedUnion('sourceType', [
  z
    .object({
      sourceType: z.literal('judgment' satisfies LegalSourceType),
      /** The authority document id (`LegalAuthority.id`). */
      sourceId: z.string().trim().min(1),
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
      sourceId: z.string().trim().min(1),
      /** The label path within the Act, e.g. `section/40`. */
      labelPath: z.string().trim().min(1),
    })
    .strict(),
])
export type EvidenceReference = z.infer<typeof evidenceReferenceSchema>

/**
 * The stable id a finding, report or UI key uses for a reference. The judgment
 * form is byte-identical to `createJudgmentParagraphEvidenceId` in
 * `packages/search-client`, which anchors search evidence the same way; the two
 * must not diverge, and the test pins the format.
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
