import { describe, expect, it } from 'bun:test'
import {
  detectNer,
  NER_DEFAULT_CHUNK_TOKENS,
  type TokenClassifier,
} from './classifier'

function aggregated(
  label: string,
  start: number,
  end: number,
  score = 0.9,
) {
  return { entity_group: label, score, start, end, word: label }
}

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

  it('scans the whole input as one window when the classifier has no token counter', async () => {
    const windows: string[] = []
    const classifier: TokenClassifier = async (window) => {
      windows.push(window)
      return []
    }
    const raw = 'a'.repeat(5000)

    await detectNer(raw, classifier, 0.4, 100)

    expect(windows).toEqual([raw])
  })

  it('sizes windows by the model token count rather than by characters', async () => {
    const lengths: number[] = []
    const classifier: TokenClassifier = async (window) => {
      lengths.push(window.length)
      return []
    }
    classifier.countTokens = (value) => value.length * 2

    await detectNer('a'.repeat(250), classifier, 0.4, 100)

    expect(lengths.length).toBeGreaterThan(1)
    expect(Math.max(...lengths)).toBeLessThanOrEqual(50)
  })

  it('keeps an entity on a window seam whole inside a neighbouring window', async () => {
    const raw = `${'p'.repeat(40)} John Smith ${'q'.repeat(100)}`
    const classifier: TokenClassifier = async (window) => {
      const at = window.indexOf('John Smith')
      return at < 0
        ? []
        : [aggregated('GIVEN_NAME', at, at + 'John Smith'.length)]
    }
    classifier.countTokens = (value) => value.length

    const spans = await detectNer(raw, classifier, 0.4, 50)

    expect(spans.map((span) => span.text)).toEqual(['John Smith'])
  })

  it('never cuts a word at a window boundary', async () => {
    const raw = 'alpha bravo charlie delta echo foxtrot golf hotel india'
    const windows: string[] = []
    const classifier: TokenClassifier = async (window) => {
      windows.push(window)
      return []
    }
    classifier.countTokens = (value) => value.length

    await detectNer(raw, classifier, 0.4, 20)

    expect(windows.length).toBeGreaterThan(1)
    let cursor = 0
    for (const window of windows) {
      const at = raw.indexOf(window, cursor)
      cursor = at + 1
      expect(at).toBeGreaterThanOrEqual(0)
      expect(at === 0 || raw[at - 1] === ' ').toBe(true)
      const end = at + window.length
      expect(end === raw.length || raw[end - 1] === ' ').toBe(true)
    }
  })

  it('covers the whole input with its windows so no text is skipped', async () => {
    const raw = 'alpha bravo charlie delta echo foxtrot golf hotel india'
    const windows: string[] = []
    const classifier: TokenClassifier = async (window) => {
      windows.push(window)
      return []
    }
    classifier.countTokens = (value) => value.length

    await detectNer(raw, classifier, 0.4, 20)

    let cursor = 0
    const starts = windows.map((window) => {
      const at = raw.indexOf(window, cursor)
      cursor = at + 1
      return at
    })
    expect(starts[0]).toBe(0)
    for (let index = 1; index < starts.length; index++) {
      expect(starts[index]).toBeLessThanOrEqual(
        starts[index - 1]! + windows[index - 1]!.length,
      )
    }
    const last = starts.length - 1
    expect(starts[last]! + windows[last]!.length).toBe(raw.length)
  })

  it('runs windows one at a time because one model session cannot take concurrent inference', async () => {
    let inFlight = 0
    let peak = 0
    const classifier: TokenClassifier = async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight--
      return []
    }
    classifier.countTokens = (value) => value.length

    await detectNer('word '.repeat(40), classifier, 0.4, 20)

    expect(peak).toBe(1)
  })

  it('collapses an exact duplicate detected in two overlapping windows', async () => {
    const raw = 'word0 word1 word2 word3 word4 word5 word6'
    const classifier: TokenClassifier = async (window) => {
      const at = window.indexOf('word2')
      return at < 0 ? [] : [aggregated('PHONE', at, at + 5)]
    }
    classifier.countTokens = (value) => value.length

    const spans = await detectNer(raw, classifier, 0.4, 30)

    expect(spans).toEqual([
      expect.objectContaining({ start: 12, end: 17, text: 'word2' }),
    ])
  })

  it('asks the pipeline for simple aggregation', async () => {
    let received: unknown
    const classifier: TokenClassifier = async (_window, options) => {
      received = options
      return []
    }

    await detectNer('text', classifier)

    expect(received).toEqual({ aggregation_strategy: 'simple' })
  })

  it('drops an entity group the label map does not know', async () => {
    const spans = await detectNer('born 1970', async () => [
      aggregated('DATE', 5, 9),
    ])

    expect(spans).toEqual([])
  })

  it('drops a detection below the minimum score', async () => {
    const spans = await detectNer(
      'call 123',
      async () => [aggregated('PHONE', 5, 8, 0.3)],
      0.4,
    )

    expect(spans).toEqual([])
  })

  it('drops a zero-width detection', async () => {
    const spans = await detectNer('abc', async () => [
      aggregated('PHONE', 1, 1),
    ])

    expect(spans).toEqual([])
  })

  it('returns a kept-class detection so the policy layer can shield it', async () => {
    const spans = await detectNer('Leeds', async () => [
      aggregated('CITY', 0, 5),
    ])

    expect(spans.map((span) => span.label)).toEqual(['CITY'])
  })

  it('keeps a given name and a surname as separate labels', async () => {
    const spans = await detectNer('John Smith', async () => [
      aggregated('GIVEN_NAME', 0, 4),
      aggregated('SURNAME', 5, 10),
    ])

    expect(spans.map((span) => span.label)).toEqual([
      'GIVEN_NAME',
      'SURNAME',
    ])
  })

  it('keeps offsets aligned when a hyphen is folded to a space before inference', async () => {
    const raw = 'tel 0123-456-7890 end'
    const classifier: TokenClassifier = async (window) => {
      const at = window.indexOf('0123 456 7890')
      return at < 0 ? [] : [aggregated('PHONE', at, at + 13)]
    }

    const spans = await detectNer(raw, classifier)

    expect(spans[0]).toMatchObject({
      start: 4,
      end: 17,
      text: '0123-456-7890',
    })
  })

  it('extends a span with a matching I token even when the separator is not a name connector', async () => {
    const classifier: TokenClassifier = async () => [
      { entity: 'B-GIVEN_NAME', score: 0.9, start: 0, end: 0, word: 'john' },
      { entity: 'I-GIVEN_NAME', score: 0.9, start: 0, end: 0, word: 'smith' },
    ]

    const spans = await detectNer('john/smith', classifier)

    expect(spans).toEqual([
      expect.objectContaining({ start: 0, end: 10, text: 'john/smith' }),
    ])
  })

  it('recovers the raw offset of an accented name from the folded projection', async () => {
    const classifier: TokenClassifier = async () => [
      { entity: 'B-GIVEN_NAME', score: 0.9, start: 0, end: 0, word: 'jose' },
    ]

    const spans = await detectNer('José called', classifier)

    expect(spans[0]).toMatchObject({ start: 0, end: 4, text: 'José' })
  })

  it('resolves a repeated substring through the token index instead of the first match', async () => {
    const classifier: TokenClassifier = async () => [
      {
        entity: 'B-PHONE',
        score: 0.9,
        start: 0,
        end: 0,
        word: '123',
        index: 4,
      },
    ]
    classifier.tokenize = (value) => value.split(' ')

    const spans = await detectNer('the 123 then 123', classifier)

    expect(spans).toEqual([
      expect.objectContaining({ start: 13, end: 16, text: '123' }),
    ])
  })

  it('bridges a full stop only across a single-letter initial', async () => {
    const initial = await detectNer('J. R. Smith', async () => [
      aggregated('GIVEN_NAME', 0, 1),
      aggregated('GIVEN_NAME', 3, 4),
    ])
    const word = await detectNer('Garcia. I', async () => [
      aggregated('GIVEN_NAME', 0, 6),
      aggregated('GIVEN_NAME', 8, 9),
    ])

    expect(initial.map((span) => span.text)).toEqual(['J. R'])
    expect(word.map((span) => span.text)).toEqual(['Garcia', 'I'])
  })

  it('extends a name left across a one-letter initial but not a title', async () => {
    const initial = await detectNer('J. Smith', async () => [
      aggregated('SURNAME', 3, 8),
    ])
    const title = await detectNer('Dr. Smith', async () => [
      aggregated('SURNAME', 4, 9),
    ])

    expect(initial[0]).toMatchObject({ start: 0, end: 8, text: 'J. Smith' })
    expect(title[0]).toMatchObject({ start: 4, end: 9, text: 'Smith' })
  })

  it('never extends a name rightwards across a full stop', async () => {
    const spans = await detectNer('Chen. After', async () => [
      aggregated('SURNAME', 0, 4),
    ])

    expect(spans[0]).toMatchObject({ start: 0, end: 4, text: 'Chen' })
  })

  it('does not extend a name into a title or heading word', async () => {
    const spans = await detectNer('Smith Ltd', async () => [
      aggregated('SURNAME', 0, 5),
    ])

    expect(spans[0]).toMatchObject({ start: 0, end: 5, text: 'Smith' })
  })

  it('does not extend a person name into a region another detection already claims', async () => {
    const spans = await detectNer('John Smith', async () => [
      aggregated('GIVEN_NAME', 0, 4),
      aggregated('SURNAME', 5, 10),
    ])

    expect(spans.map((span) => span.text)).toEqual(['John', 'Smith'])
  })
})
