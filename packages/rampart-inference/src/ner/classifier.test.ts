import { describe, expect, it } from 'vitest'
import {
  detectNer,
  NER_TOKEN_BUDGET,
  type TokenClassifier,
} from './classifier'

describe('detectNer', () => {
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
