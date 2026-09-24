import { describe, expect, it } from 'bun:test'
import * as verificationCore from './index'

describe('Public package exports', () => {
  it('exports the identity and normalisation functions', () => {
    expect(typeof verificationCore.createVerificationFindingId).toBe('function')
    expect(typeof verificationCore.createEvidenceReferenceId).toBe('function')
    expect(typeof verificationCore.normalizeLegislationCitationPath).toBe(
      'function',
    )
    expect(typeof verificationCore.requiresReview).toBe('function')
  })

  it('exports every domain schema through the package entry point', () => {
    const schemas = [
      verificationCore.citationInputSchema,
      verificationCore.normalizedCitationSchema,
      verificationCore.citationUnresolvedReasonSchema,
      verificationCore.evidenceReferenceSchema,
      verificationCore.verificationFindingSchema,
      verificationCore.findingTypeSchema,
      verificationCore.findingSeveritySchema,
      verificationCore.findingConfidenceSchema,
      verificationCore.findingStatusSchema,
      verificationCore.reviewReasonSchema,
      verificationCore.draftLocationSchema,
      verificationCore.verificationSubjectSchema,
      verificationCore.authorityDocumentIdSchema,
      verificationCore.legislationDocumentIdentitySchema,
      verificationCore.legislationLabelPathSchema,
    ]

    for (const schema of schemas) {
      expect(typeof schema.parse).toBe('function')
    }
  })
})
