import { describe, expect, it } from 'vitest'
import { createRedactionDetector } from './redaction-detection'

const classifier = (async () => []) as never

describe('redaction detection', () => {
  it('maps model and deterministic spans then merges supplement overlaps', async () => {
    const detect = createRedactionDetector({
      loadClassifier: async () => classifier,
      detectNer: async () => [{ start: 0, end: 10, label: 'GIVEN_NAME', score: 0.99, source: 'ner', text: 'Jane Smith' }],
      log: () => undefined,
    })
    const result = await detect('Jane Smith emailed jane@example.com.')
    expect(result.degraded).toBe(false)
    expect(result.spans).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: 'Jane Smith', category: 'person_name', source: 'rampart_model' }),
      expect.objectContaining({ text: 'jane@example.com', category: 'email', source: 'rampart_deterministic' }),
    ]))
  })

  it('completes supplement-only with an honest version when model loading fails', async () => {
    const detect = createRedactionDetector({ loadClassifier: async () => { throw new Error('mirror unavailable') }, log: () => undefined })
    const result = await detect('Email jane@example.com or call 07700 900482.')
    expect(result.degraded).toBe(true)
    expect(result.detectorVersion).toContain('mode=supplement-only')
    expect(result.spans).toEqual(expect.arrayContaining([expect.objectContaining({ category: 'email' })]))
  })

  it('preserves original character offsets after premasking a long document', async () => {
    const prefix = 'word '.repeat(600)
    const text = `${prefix}Jane Smith`
    const detect = createRedactionDetector({
      loadClassifier: async () => classifier,
      detectNer: async (masked) => [{ start: masked.indexOf('Jane'), end: masked.length, label: 'SURNAME', score: 0.9, source: 'ner', text: 'Jane Smith' }],
      log: () => undefined,
    })
    const result = await detect(text)
    expect(result.spans).toEqual(expect.arrayContaining([expect.objectContaining({ start: prefix.length, end: text.length, text: 'Jane Smith' })]))
  })
})
