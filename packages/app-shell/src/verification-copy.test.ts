import { describe, expect, it } from 'bun:test'
import {
  verificationReasonLabel,
  verificationStateLabel,
  verificationTypeLabel,
} from './verification-copy'

describe('verification copy', () => {
  it('does not use internal discriminant names as user copy', () => {
    expect(verificationTypeLabel('authority_existence')).toBe(
      'Authority existence',
    )
    expect(verificationStateLabel('review_required')).toBe('Needs review')
    expect(verificationReasonLabel('authority_not_held')).toBe(
      'The stored sources do not hold this authority.',
    )
    expect(verificationReasonLabel('authority_not_held')).not.toContain(
      'authority_not_held',
    )
  })
})
