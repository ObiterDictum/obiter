import { describe, expect, it } from 'bun:test'
import type { Span as RampartSpan } from '@obiter/rampart-inference'
import {
  applyRedacted,
  type Decisions,
  type RedactionSpan,
} from '@obiter/redaction-policy'
import { createRedactionDetector } from './redaction-detection'

/**
 * P0.31: `policy.mergeSpans` decides both coverage and disposition, and it
 * inherits the preferred detection's label for the whole union. A keep-category
 * winner can therefore disposition bytes a redact detection contributed, and
 * containment can drop a redact loser's exclusive bytes. These drive the real
 * detector with synthetic model spans over filler text that no heuristic or UK
 * supplement pattern matches, so the geometry under test is exactly the
 * contributors given. The final case drives a real premasked URL, the only
 * reachable keep-category label in the pinned pipeline.
 */

const classifier = (async () => []) as never

/** Lowercase filler: no heuristic match and no UK supplement pattern match. */
const filler = 'alpha bravo charlie delta echo foxtrot'

function at(word: string, text: string = filler) {
  const start = text.indexOf(word)
  return { start, end: start + word.length, text: word }
}

function modelSpan(
  label: RampartSpan['label'],
  range: { start: number; end: number; text: string },
  score: number,
): RampartSpan {
  return {
    start: range.start,
    end: range.end,
    label,
    score,
    source: 'ner',
    text: range.text,
  }
}

async function detected(
  text: string,
  spans: RampartSpan[],
): Promise<RedactionSpan[]> {
  const detect = createRedactionDetector({
    loadClassifier: async () => classifier,
    detectNer: async () => spans,
    log: () => undefined,
  })
  return (await detect(text)).spans
}

function fromSuggestions(spans: RedactionSpan[]): Decisions {
  return Object.fromEntries(
    spans.map((span) => [
      span.id,
      {
        decision: span.suggestion === 'redact' ? 'accept' : 'reject',
        decidedBy: 'usr_1',
        decidedAt: '2026-01-01T00:00:00.000Z',
      } as Decisions[string],
    ]),
  )
}

describe('overlap disposition (P0.31)', () => {
  const keepAbove = modelSpan('URL', at('bravo charl'), 0.99)
  const redactBelow = modelSpan('GIVEN_NAME', at('charlie'), 0.5)

  it('redacts a union whose higher-confidence contributor would keep', async () => {
    const spans = await detected(filler, [keepAbove, redactBelow])
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({
      start: 6,
      end: 19,
      text: 'bravo charlie',
      suggestion: 'redact',
    })
    expect(filler.slice(spans[0]!.start, spans[0]!.end)).toBe(spans[0]!.text)
  })

  it('leaves a keep-only union keeping', async () => {
    const spans = await detected(filler, [
      modelSpan('URL', at('bravo charl'), 0.99),
      modelSpan('URL', at('charlie'), 0.4),
    ])
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ suggestion: 'keep', end: 19 })
  })

  it('leaves a redact-only union redacting', async () => {
    const spans = await detected(filler, [
      modelSpan('GIVEN_NAME', at('bravo charl'), 0.99),
      modelSpan('SURNAME', at('charlie'), 0.4),
    ])
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ suggestion: 'redact', end: 19 })
  })

  it('redacts a union whether the redact detection wins or loses preference', async () => {
    const redactWins = await detected(filler, [
      modelSpan('GIVEN_NAME', at('bravo charl'), 0.99),
      modelSpan('URL', at('charlie'), 0.5),
    ])
    expect(redactWins).toHaveLength(1)
    expect(redactWins[0]).toMatchObject({ suggestion: 'redact', end: 19 })
  })

  it('redacts containment when the keep detection is the container', async () => {
    const spans = await detected(filler, [
      modelSpan('URL', at('bravo charlie'), 0.99),
      modelSpan('GIVEN_NAME', at('charlie'), 0.5),
    ])
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({
      start: 6,
      end: 19,
      text: 'bravo charlie',
      suggestion: 'redact',
    })
  })

  it('restores a redact container the keep winner would have shrunk past', async () => {
    // Before P0.31 the contained URL winner collapsed the union to its own
    // range, silently keeping the container's exclusive bytes.
    const spans = await detected(filler, [
      modelSpan('GIVEN_NAME', at('bravo charlie'), 0.5),
      modelSpan('URL', at('charlie'), 0.99),
    ])
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({
      start: 6,
      end: 19,
      text: 'bravo charlie',
      suggestion: 'redact',
    })
  })

  it('redacts equal ranges regardless of contributor order', async () => {
    for (const spans of [
      [
        modelSpan('URL', at('charlie'), 0.99),
        modelSpan('GIVEN_NAME', at('charlie'), 0.5),
      ],
      [
        modelSpan('GIVEN_NAME', at('charlie'), 0.5),
        modelSpan('URL', at('charlie'), 0.99),
      ],
    ]) {
      const result = await detected(filler, spans)
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        start: 12,
        end: 19,
        text: 'charlie',
        suggestion: 'redact',
      })
    }
  })

  it('carries a redact detection across a chained overlap', async () => {
    // [0,10] keep -- [8,15] redact -- [13,20] keep: the middle detection must
    // not be stranded between two keep winners.
    const text = filler.slice(0, 21)
    const spans = await detected(text, [
      modelSpan('URL', { start: 0, end: 10, text: text.slice(0, 10) }, 0.9),
      modelSpan(
        'GIVEN_NAME',
        { start: 8, end: 15, text: text.slice(8, 15) },
        0.5,
      ),
      modelSpan('URL', { start: 13, end: 20, text: text.slice(13, 20) }, 0.9),
    ])
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ start: 0, end: 20, suggestion: 'redact' })
    expect(spans[0]!.text).toBe(text.slice(0, 20))
  })

  it('is order-independent for chained overlaps', async () => {
    const text = filler.slice(0, 21)
    const contributors = [
      modelSpan('URL', { start: 0, end: 10, text: text.slice(0, 10) }, 0.9),
      modelSpan(
        'GIVEN_NAME',
        { start: 8, end: 15, text: text.slice(8, 15) },
        0.5,
      ),
      modelSpan('URL', { start: 13, end: 20, text: text.slice(13, 20) }, 0.9),
    ]
    const permutations = [
      contributors,
      [...contributors].reverse(),
      [contributors[1]!, contributors[2]!, contributors[0]!],
      [contributors[2]!, contributors[0]!, contributors[1]!],
    ]
    const results = []
    for (const permutation of permutations)
      results.push(await detected(text, permutation))
    for (const result of results) expect(result).toEqual(results[0])
    expect(results[0]![0]).toMatchObject({ suggestion: 'redact' })
  })

  it('keeps offsets, text and a full emoji intact through the union', async () => {
    const text = 'a😀bravo charlie'
    const emojiStart = text.indexOf('😀')
    const bravoStart = text.indexOf('bravo')
    const charlieStart = text.indexOf('charlie')
    const spans = await detected(text, [
      modelSpan(
        'URL',
        {
          start: emojiStart,
          end: bravoStart + 5,
          text: text.slice(emojiStart, bravoStart + 5),
        },
        0.99,
      ),
      modelSpan(
        'GIVEN_NAME',
        {
          start: bravoStart,
          end: charlieStart + 7,
          text: text.slice(bravoStart, charlieStart + 7),
        },
        0.5,
      ),
    ])
    expect(spans).toHaveLength(1)
    for (const span of spans)
      expect(text.slice(span.start, span.end)).toBe(span.text)
    expect(spans[0]).toMatchObject({ start: emojiStart, end: text.length })
    expect(spans[0]!.text).toBe('😀bravo charlie')
    expect(spans[0]!.suggestion).toBe('redact')
  })

  it('still trims a person detection before the union (P0.30)', async () => {
    const text = 'Mr. charlie delta'
    const spans = await detected(text, [
      modelSpan(
        'GIVEN_NAME',
        { start: 0, end: 11, text: text.slice(0, 11) },
        0.9,
      ),
    ])
    expect(spans.map((span) => span.text)).toEqual(['charlie'])
    expect(spans[0]!.suggestion).toBe('redact')
  })

  it('leaves no redact-required content in the automatic output', async () => {
    // The pinned model emits no DATE, so a keep-category winner over redact
    // coverage needs a reachable keep label. URL is the only one, and it is
    // premasked: the model sees "[URL] Alice" and its span projects back over
    // the URL's whole raw range plus the name beside it.
    const text = 'https://x.com Alice'
    const detect = createRedactionDetector({
      loadClassifier: async () => classifier,
      detectNer: async (masked) => [
        modelSpan(
          'GIVEN_NAME',
          { start: 0, end: masked.length, text: masked },
          0.9,
        ),
      ],
      log: () => undefined,
    })
    const result = await detect(text)
    expect(result.spans).toHaveLength(1)
    expect(result.spans[0]).toMatchObject({
      start: 0,
      end: text.length,
      suggestion: 'redact',
    })
    // Automatic policy: follow the detector's own suggestion. Before P0.31 the
    // union was a keep-suggestion URL span, so this reject left "Alice" in the
    // output; the assertion is on the produced bytes, not an intermediate label.
    const output = applyRedacted(
      text,
      result.spans,
      fromSuggestions(result.spans),
    )
    expect(output).not.toContain('Alice')
    expect(output).toBe('[REDACTED]')
  })

  it('preserves an explicit reviewer override of the automatic suggestion', async () => {
    const text = 'https://x.com Alice'
    const detect = createRedactionDetector({
      loadClassifier: async () => classifier,
      detectNer: async (masked) => [
        modelSpan(
          'GIVEN_NAME',
          { start: 0, end: masked.length, text: masked },
          0.9,
        ),
      ],
      log: () => undefined,
    })
    const { spans } = await detect(text)
    const span = spans[0]!
    const keep: Decisions = {
      [span.id]: {
        decision: 'override_keep',
        decidedBy: 'usr_1',
        decidedAt: '2026-01-01T00:00:00.000Z',
      },
    }
    const redact: Decisions = {
      [span.id]: {
        decision: 'override_redact',
        decidedBy: 'usr_1',
        decidedAt: '2026-01-01T00:00:00.000Z',
      },
    }
    expect(applyRedacted(text, spans, keep)).toBe(text)
    expect(applyRedacted(text, spans, redact)).toBe('[REDACTED]')
  })
})
