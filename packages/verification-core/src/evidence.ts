import type { LegalSourceType } from '@obiter/legal-schema'
import { z } from 'zod'
import {
  authorityDocumentIdSchema,
  legislationDocumentIdentitySchema,
  legislationLabelPathSchema,
} from './identity'

export const evidenceGranularitySchema = z.enum(['document', 'fragment'])
export type EvidenceGranularity = z.infer<typeof evidenceGranularitySchema>

const judgmentParagraphEvidenceSchema = z
  .object({
    sourceType: z.literal('judgment' satisfies LegalSourceType),
    granularity: z.literal('fragment'),
    sourceId: authorityDocumentIdSchema,
    ordinal: z.number().int().positive(),
    paragraphNumber: z.number().int().positive().nullable(),
  })
  .strict()

const judgmentDocumentEvidenceSchema = z
  .object({
    sourceType: z.literal('judgment' satisfies LegalSourceType),
    granularity: z.literal('document'),
    sourceId: authorityDocumentIdSchema,
  })
  .strict()

const legislationProvisionEvidenceSchema = z
  .object({
    sourceType: z.literal('legislation_provision' satisfies LegalSourceType),
    granularity: z.literal('fragment'),
    sourceId: legislationDocumentIdentitySchema,
    labelPath: legislationLabelPathSchema,
  })
  .strict()

const legislationDocumentEvidenceSchema = z
  .object({
    sourceType: z.literal('legislation_document' satisfies LegalSourceType),
    granularity: z.literal('document'),
    sourceId: legislationDocumentIdentitySchema,
  })
  .strict()

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

export function isDocumentEvidenceReference(
  reference: EvidenceReference,
): boolean {
  return reference.granularity === 'document'
}

export function isFragmentEvidenceReference(
  reference: EvidenceReference,
): boolean {
  return reference.granularity === 'fragment'
}

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
