// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VerificationFindingsList } from './verification-findings'
import type { VerificationFindingView } from '@obiter/contracts'

const finding: VerificationFindingView = {
  id: 'vf:1:doc:1:ver:authority_existence:1:p1:1:0:1:13',
  type: 'quote_fidelity',
  state: 'review_required',
  reviewReason: 'check_inconclusive',
  severity: 'medium',
  confidence: 'low',
  requiresReview: true,
  explanation: 'The quotation could not be located in the stored source.',
  excerpt: 'the court must consider',
  location: { paragraphId: 'p1', start: 0, end: 22 },
  authorityLabel: '[2024] UKSC 1',
  evidence: [
    {
      id: 'uksc-1:judgment_paragraph:4',
      sourceId: 'uksc-1',
      label: 'Judgment uksc-1, paragraph 4',
    },
  ],
}

describe('VerificationFindingsList', () => {
  it('shows type, review state, explanation, excerpt, evidence identity, and reason copy', () => {
    render(<VerificationFindingsList findings={[finding]} />)
    expect(screen.getByText('Quote fidelity')).toBeTruthy()
    expect(screen.getByText('Needs review')).toBeTruthy()
    expect(screen.getByText('Severity medium')).toBeTruthy()
    expect(screen.getByText('Confidence low')).toBeTruthy()
    expect(
      screen.getByText(
        'The quotation could not be located in the stored source.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('the court must consider')).toBeTruthy()
    expect(screen.getByText(/uksc-1:judgment_paragraph:4/)).toBeTruthy()
    expect(
      screen.getByText('The check could not reach a conclusion.'),
    ).toBeTruthy()
    expect(screen.queryByText('check_inconclusive')).toBeNull()
    expect(screen.queryByText('quote_fidelity')).toBeNull()
  })

  it('explains an empty completed run without claiming correctness', () => {
    render(<VerificationFindingsList findings={[]} />)
    expect(
      screen.getByText(
        /found nothing to list. That is not a statement of legal correctness/,
      ),
    ).toBeTruthy()
  })

  it('distinguishes clear, flagged, and not-checked outcomes', () => {
    const clear: VerificationFindingView = {
      ...finding,
      id: 'vf:clear',
      type: 'authority_existence',
      state: 'clear',
      reviewReason: null,
      requiresReview: false,
      explanation: 'The stored sources hold this authority.',
    }
    const flagged: VerificationFindingView = {
      ...finding,
      id: 'vf:flagged',
      state: 'flagged',
      reviewReason: null,
      requiresReview: false,
      explanation: 'The stored source does not contain the quoted words.',
    }
    const notChecked: VerificationFindingView = {
      ...finding,
      id: 'vf:not_checked',
      type: 'citation_resolution',
      state: 'not_checked',
      reviewReason: null,
      severity: null,
      confidence: null,
      requiresReview: true,
      explanation: 'The check did not run.',
      evidence: [],
    }
    render(<VerificationFindingsList findings={[clear, flagged, notChecked]} />)
    expect(screen.getByText('Clear')).toBeTruthy()
    expect(screen.getByText('Flagged')).toBeTruthy()
    expect(screen.getByText('Not checked')).toBeTruthy()
    // A check that did not run must say so rather than imply an absent source.
    expect(screen.getAllByText('No source evidence attached.')).toHaveLength(1)
  })
})
