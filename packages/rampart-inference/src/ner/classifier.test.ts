import { describe, expect, it } from 'bun:test'
import {
  detectNer,
  NER_DEFAULT_CHUNK_TOKENS,
  type TokenClassifier,
} from './classifier'

describe('detectNer', () => {
  it('uses the configured token budget for long input windows', async () => {
    const windowLengths: number[] = []
    const classifier: TokenClassifier = async (window) => {
      windowLengths.push(window.length)
      return []
    }
    classifier.countTokens = (value) => value.length

    await detectNer('a'.repeat(250), classifier, 0.4, 100)

    expect(windowLengths.length).toBeGreaterThan(1)
    expect(Math.max(...windowLengths)).toBeLessThanOrEqual(100)
  })

  it('preserves exact first, middle and final offsets across a long document', async () => {
    const markers = ['FIRST', 'MIDDLE', 'FINAL']
    const text = `FIRST${'a'.repeat(240)}MIDDLE${'b'.repeat(340)}FINAL`
    let calls = 0
    const classifier: TokenClassifier = async (window) => {
      calls++
      return markers.flatMap((marker) => {
        const start = window.indexOf(marker)
        return start < 0
          ? []
          : [
              {
                entity_group: 'PHONE',
                score: 0.99,
                start,
                end: start + marker.length,
                word: marker,
              },
            ]
      })
    }
    classifier.countTokens = (value) => value.length

    const spans = await detectNer(text, classifier, 0.4, 200)

    expect(calls).toBeGreaterThan(3)
    expect(spans.map(({ start, end, text: value }) => ({ start, end, value })))
      .toEqual(
        markers.map((marker) => {
          const start = text.indexOf(marker)
          return { start, end: start + marker.length, value: marker }
        }),
      )
  })

  it('retains overlap across hard-split default-sized segments', async () => {
    const entity = 'ENTITY'
    const start = NER_DEFAULT_CHUNK_TOKENS - 3
    const text = `${'a'.repeat(start)}${entity}${'b'.repeat(NER_DEFAULT_CHUNK_TOKENS)}`
    const classifier: TokenClassifier = async (window) => {
      const entityStart = window.indexOf(entity)
      return entityStart < 0
        ? []
        : [
            {
              entity_group: 'PHONE',
              score: 0.99,
              start: entityStart,
              end: entityStart + entity.length,
              word: entity,
            },
          ]
    }
    classifier.countTokens = (value) => value.length

    const spans = await detectNer(text, classifier)

    expect(spans).toEqual([
      expect.objectContaining({
        start,
        end: start + entity.length,
        text: entity,
      }),
    ])
  })

  it('does not glue a surname across a newline into a heading word', async () => {
    const text = 'Jones\nLaw and software'
    const classifier: TokenClassifier = async () => [
      {
        entity_group: 'SURNAME',
        score: 0.92,
        start: 0,
        end: 5,
        word: 'Jones',
      },
    ]

    const spans = await detectNer(text, classifier)

    expect(spans).toHaveLength(1)
    expect(spans[0]?.text).toBe('Jones')
    expect(spans[0]?.end).toBe(5)
  })

  it('keeps overlapping detections from separate windows as contributors', async () => {
    // P0.31: the cross-window step must not collapse a redact contributor
    // under a keep winner's label. Upstream's mergeSpans would return one URL
    // span [50,80); this test fails if that merge is restored.
    const text =
      'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima ' +
      'mike november oscar papa quebec romeo sierra tango uniform victor whiskey ' +
      'xray yankee zulu'
    let cursor = 0
    let call = 0
    const classifier: TokenClassifier = async (window) => {
      const at = text.indexOf(window, cursor)
      if (at < 0) throw new Error('classifier window not found in source')
      cursor = at + 1
      const index = call++
      const emit = (
        entity_group: string,
        score: number,
        start: number,
        end: number,
      ) => ({
        entity_group,
        score,
        start: start - at,
        end: end - at,
        word: entity_group,
      })
      if (index === 0) return [emit('URL', 0.95, 50, 70)]
      if (index === 1) return [emit('GIVEN_NAME', 0.5, 60, 80)]
      return []
    }
    classifier.countTokens = (value) => value.length

    const spans = await detectNer(text, classifier, 0.4, 100)

    expect(spans.map(({ start, end, label }) => ({ start, end, label }))).toEqual(
      [
        { start: 50, end: 70, label: 'URL' },
        { start: 60, end: 80, label: 'GIVEN_NAME' },
      ],
    )
  })
})
