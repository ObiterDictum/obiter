import { describe, expect, it } from 'vitest'
import {
  applyPseudonymised,
  applyRedacted,
  createTokenMap,
  RedactionSpanIntegrityError,
} from './apply'
import type { Decisions, RedactionSpan } from './types'

const text = 'James Cartwright met James Cartwright at 10 Downing Street.'
const spans: RedactionSpan[] = [
  {
    id: 'span_1',
    start: 0,
    end: 16,
    text: 'James Cartwright',
    category: 'person_name',
    source: 'rampart_model',
    confidence: 'high',
    suggestion: 'redact',
  },
  {
    id: 'span_2',
    start: 21,
    end: 37,
    text: 'James Cartwright',
    category: 'person_name',
    source: 'rampart_model',
    confidence: 'high',
    suggestion: 'redact',
  },
  {
    id: 'span_3',
    start: 41,
    end: 58,
    text: '10 Downing Street',
    category: 'address',
    source: 'rampart_model',
    confidence: 'high',
    suggestion: 'redact',
  },
]

const decisions: Decisions = {
  span_1: {
    decision: 'accept',
    decidedBy: 'usr_1',
    decidedAt: '2026-07-09T00:00:00.000Z',
  },
  span_2: {
    decision: 'pseudonymise',
    decidedBy: 'usr_1',
    decidedAt: '2026-07-09T00:00:00.000Z',
  },
  span_3: {
    decision: 'reject',
    decidedBy: 'usr_1',
    decidedAt: '2026-07-09T00:00:00.000Z',
  },
}

describe('redaction output application', () => {
  it('redacts only output-affecting decisions', () => {
    expect(applyRedacted(text, spans, decisions)).toBe(
      '[REDACTED] met [REDACTED] at 10 Downing Street.',
    )
  })

  it('uses a stable category token for repeated entity text', () => {
    expect(applyPseudonymised(text, spans, decisions)).toBe(
      '[PERSON_NAME_1] met [PERSON_NAME_1] at 10 Downing Street.',
    )
    expect(createTokenMap(text, spans, decisions)).toEqual({
      PERSON_NAME_1: 'James Cartwright',
    })
  })

  it('leaves undecided and keep decisions unchanged', () => {
    expect(applyRedacted(text, spans, {})).toBe(text)
    expect(
      applyRedacted(text, spans, {
        span_1: {
          decision: 'override_keep',
          decidedBy: 'usr_1',
          decidedAt: '2026-07-09T00:00:00.000Z',
        },
      }),
    ).toBe(text)
  })

  it('fails closed when an output-affecting span no longer matches its offset', () => {
    expect(() =>
      applyRedacted(
        'James Carter met James Cartwright at 10 Downing Street.',
        spans,
        decisions,
      ),
    ).toThrow(RedactionSpanIntegrityError)
  })
})
