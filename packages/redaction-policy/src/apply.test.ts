import { describe, expect, it } from 'bun:test'
import {
  applyPseudonymised,
  applyRedacted,
  coalesceRedactionRegions,
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

  it('leaves the output byte-identical when every span is rejected', () => {
    const rejected = Object.fromEntries(
      spans.map((span) => [
        span.id,
        {
          decision: 'reject' as const,
          decidedBy: 'usr_1',
          decidedAt: '2026-07-09T00:00:00.000Z',
        },
      ]),
    )

    expect(applyRedacted(text, spans, rejected)).toBe(text)
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

function spanAt(
  text: string,
  word: string,
  id: string,
  from = 0,
): RedactionSpan {
  const start = text.indexOf(word, from)
  if (start === -1) throw new Error(`missing ${word} in test text`)
  return {
    id,
    start,
    end: start + word.length,
    text: word,
    category: 'person_name',
    source: 'rampart_model',
    confidence: 'high',
    suggestion: 'redact',
  }
}

function acceptAll(spans: RedactionSpan[]): Decisions {
  return Object.fromEntries(
    spans.map((span) => [
      span.id,
      {
        decision: 'accept' as const,
        decidedBy: 'usr_1',
        decidedAt: '2026-07-09T00:00:00.000Z',
      },
    ]),
  )
}

describe('finalized region coalescing', () => {
  const sentence = 'Met with John Michael Smith yesterday.'
  const names = () => [
    spanAt(sentence, 'John', 'span_john'),
    spanAt(sentence, 'Michael', 'span_michael'),
    spanAt(sentence, 'Smith', 'span_smith'),
  ]

  it('replaces three adjacent accepted words with one marker', () => {
    const spans = names()
    expect(applyRedacted(sentence, spans, acceptAll(spans))).toBe(
      'Met with [REDACTED] yesterday.',
    )
  })

  it('plans one region that keeps every original span id', () => {
    const spans = names()
    expect(coalesceRedactionRegions(sentence, spans, acceptAll(spans))).toEqual(
      [
        {
          start: 9,
          end: 27,
          spanIds: ['span_john', 'span_michael', 'span_smith'],
        },
      ],
    )
  })

  it('does not duplicate a mark for overlapping or contained spans', () => {
    const spans = [
      spanAt(sentence, 'John Michael', 'span_full'),
      spanAt(sentence, 'Michael Smith', 'span_partial'),
    ]
    expect(applyRedacted(sentence, spans, acceptAll(spans))).toBe(
      'Met with [REDACTED] yesterday.',
    )
  })

  it('does not bridge a newline', () => {
    const text = 'John\nMichael'
    const spans = [
      spanAt(text, 'John', 'span_john'),
      spanAt(text, 'Michael', 'span_michael'),
    ]
    expect(applyRedacted(text, spans, acceptAll(spans))).toBe(
      '[REDACTED]\n[REDACTED]',
    )
  })

  it('does not bridge visible text', () => {
    const text = 'John and Michael'
    const spans = [
      spanAt(text, 'John', 'span_john'),
      spanAt(text, 'Michael', 'span_michael'),
    ]
    expect(applyRedacted(text, spans, acceptAll(spans))).toBe(
      '[REDACTED] and [REDACTED]',
    )
  })

  it('bridges punctuation only when it is inside an accepted range', () => {
    const text = 'John, Michael'
    const withoutComma = [
      spanAt(text, 'John', 'span_john'),
      spanAt(text, 'Michael', 'span_michael'),
    ]
    expect(applyRedacted(text, withoutComma, acceptAll(withoutComma))).toBe(
      '[REDACTED], [REDACTED]',
    )
    const withComma = [
      spanAt(text, 'John,', 'span_john'),
      spanAt(text, 'Michael', 'span_michael'),
    ]
    expect(applyRedacted(text, withComma, acceptAll(withComma))).toBe(
      '[REDACTED]',
    )
  })

  it('does not absorb rejected or unreviewed spans', () => {
    const text = 'John Michael Smith'
    const spans = [
      spanAt(text, 'John', 'span_john'),
      spanAt(text, 'Michael', 'span_michael'),
      spanAt(text, 'Smith', 'span_smith'),
    ]
    const decisions: Decisions = {
      ...acceptAll([spans[0]!, spans[2]!]),
      [spans[1]!.id]: {
        decision: 'reject',
        decidedBy: 'usr_1',
        decidedAt: '2026-07-09T00:00:00.000Z',
      },
    }
    expect(applyRedacted(text, spans, decisions)).toBe(
      '[REDACTED] Michael [REDACTED]',
    )
  })

  it('keeps pseudonymised tokens separate', () => {
    const spans = names()
    expect(applyPseudonymised(sentence, spans, acceptAll(spans))).toBe(
      'Met with [PERSON_NAME_1] [PERSON_NAME_2] [PERSON_NAME_3] yesterday.',
    )
  })
})
