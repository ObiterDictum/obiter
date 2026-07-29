import { describe, expect, it } from 'vitest'
import {
  detectNer,
  NER_TOKEN_BUDGET,
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

  it('retains overlap across hard-split budget-sized segments', async () => {
    const entity = 'ENTITY'
    const start = NER_TOKEN_BUDGET - 3
    const text = `${'a'.repeat(start)}${entity}${'b'.repeat(NER_TOKEN_BUDGET)}`
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
})
