import type { LegalSourceType } from '@obiter/legal-schema'
import { z } from 'zod'
import {
  authorityDocumentIdSchema,
  legislationDocumentIdentitySchema,
  legislationLabelPathSchema,
} from './identity'

/**
 * How much of a public source an evidence reference names.
 *
 * - `document`: the canonical stored source document itself. It proves the
 *   stored authority's identity and availability and nothing about its
 *   contents, so a whole-authority existence finding rests on it without
 *   claiming a paragraph or provision. It carries no location at all.
 * - `fragment`: one addressable paragraph or provision of that document. A
 *   quote, a proposition or a provision-specific finding needs a fragment,
 *   because the document alone cannot say where the supported text lives.
 *
 * The granularity is the discriminator, and it is deliberately per family so a
 * judgment reference cannot carry a legislation label path and vice versa.
 * `sourceType` stays a member of the shared `LegalSourceType` vocabulary, so a
 * rename there fails the typecheck here instead of drifting.
 */
export const evidenceGranularitySchema = z.enum(['document', 'fragment'])
export type EvidenceGranularity = z.infer<typeof evidenceGranularitySchema>

/**
 * A paragraph of a stored judgment: the only granularity that can support a
 * quote. `ordinal` is 1-based position in the document's paragraph array.
 * Evidence anchors to position, not to the number the judgment prints: a
 * block-quoted paragraph can carry a printed number that differs from its
 * position, and appendices restart at 1.
 */
const judgmentParagraphEvidenceSchema = z
  .object({
    sourceType: z.literal('judgment' satisfies LegalSourceType),
    granularity: z.literal('fragment'),
    /** The authority document id (`LegalAuthority.id`). */
    sourceId: authorityDocumentIdSchema,
    /** 1-based position in the document's paragraph array. */
    ordinal: z.number().int().positive(),
    /** The number a reader is shown, when the paragraph has one. Display only. */
    paragraphNumber: z.number().int().positive().nullable(),
  })
  .strict()

/**
 * A whole stored judgment document. It names the authority and nothing inside
 * it: no paragraph, no ordinal, no text. It is the document-identity evidence
 * a whole-authority existence finding rests on, and it is the only form that
 * survives a judgment with no addressable paragraphs.
 */
const judgmentDocumentEvidenceSchema = z
  .object({
    sourceType: z.literal('judgment' satisfies LegalSourceType),
    granularity: z.literal('document'),
    sourceId: authorityDocumentIdSchema,
  })
  .strict()

/**
 * A provision of a stored Act. `labelPath` is the label path within the Act,
 * e.g. `section/40`, and it is the addressable fragment a provision-level
 * finding needs.
 */
const legislationProvisionEvidenceSchema = z
  .object({
    sourceType: z.literal('legislation_provision' satisfies LegalSourceType),
    granularity: z.literal('fragment'),
    /** The Act identity, e.g. `ukpga/2010/15`. */
    sourceId: legislationDocumentIdentitySchema,
    labelPath: legislationLabelPathSchema,
  })
  .strict()

/**
 * A whole stored Act. It names the canonical Act identity and nothing inside
 * it, so it is the document-level evidence a whole-Act existence finding rests
 * on: the Act identity is itself the proof, and an Act that holds no
 * provisions is still a held Act.
 */
const legislationDocumentEvidenceSchema = z
  .object({
    sourceType: z.literal('legislation_document' satisfies LegalSourceType),
    granularity: z.literal('document'),
    sourceId: legislationDocumentIdentitySchema,
  })
  .strict()

/**
 * A pointer to public legal source material, traceable enough to open the
 * exact document, paragraph or provision it names. It carries ids only: never
 * the source text, and never anything from the matter under verification.
 *
 * The union is a union of the two source families, each discriminated on
 * granularity. `sourceType` is part of the discriminator: the literals are
 * members of the shared `LegalSourceType` vocabulary, so a rename there fails
 * the typecheck here instead of drifting. Because each member is strict, a
 * judgment reference cannot carry a legislation label path and a legislation
 * reference cannot carry a paragraph ordinal.
 *
 * Evidence is not source-version aware. The judgment paragraph form is the
 * shared `search-client` evidence id, which identifies a paragraph by ordinal,
 * so a re-ingested source document can repoint an ordinal; the document forms
 * carry no location and so cannot repoint. Verify does not add a second
 * source-version convention here; V5 owns that decision when these become
 * durable rows.
 */
export const evidenceReferenceSchema = z.union([
  z.discriminatedUnion('granularity', [
    judgmentParagraphEvidenceSchema,
    judgmentDocumentEvidenceSchema,
  ]),
  z.discriminatedUnion('granularity', [
    legislationProvisionEvidenceSchema,
    legislationDocumentEvidenceSchema,
  ]),
])
export type EvidenceReference = z.infer<typeof evidenceReferenceSchema>

/** True when the reference names a whole stored document, not a fragment of
 * one. A finding that needs to point at supported text may not substitute one
 * for the other; `finding.ts` enforces which granularity each finding type
 * accepts. */
export function isDocumentEvidenceReference(
  reference: EvidenceReference,
): boolean {
  return reference.granularity === 'document'
}

/** True when the reference names an addressable paragraph or provision. */
export function isFragmentEvidenceReference(
  reference: EvidenceReference,
): boolean {
  return reference.granularity === 'fragment'
}

/**
 * The stable id a finding, report or UI key uses for a reference. The judgment
 * paragraph form is byte-identical to `createJudgmentParagraphEvidenceId` in
 * `packages/search-client`, which anchors search evidence the same way; the two
 * must not diverge, and the test pins the format. That format is owned by
 * `search-client`, so the `:` join stays and the ambiguity is removed on the
 * other side instead: `sourceId` and `labelPath` are schema-constrained to
 * canonical values that cannot contain `:`, which makes the join injective.
 *
 * The document forms have no location, so their ids are the source id plus a
 * granularity suffix; they are deterministic and cannot collide with a
 * fragment id because the suffix differs.
 */
export function createEvidenceReferenceId(
  reference: EvidenceReference,
): string {
  switch (reference.sourceType) {
    case 'judgment':
      return reference.granularity === 'document'
        ? `${reference.sourceId}:judgment_document`
        : `${reference.sourceId}:judgment_paragraph:${reference.ordinal}`
    case 'legislation_document':
      return `${reference.sourceId}:legislation_document`
    case 'legislation_provision':
      return `${reference.sourceId}:legislation_provision:${reference.labelPath}`
  }
}
