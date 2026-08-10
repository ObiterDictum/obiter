import { describe, expect, it } from 'vitest'

import { buildOoxmlFixture } from '../fixtures/builder'
import {
  parseDocx,
  parseModelJson,
  serialiseModelJson,
  OoxmlError,
} from './index'

describe('document model JSON', () => {
  it('round-trips the complete shared model without mutating runtime state', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const dirtyState = [...document.sourceParts.values()].map(
      ({ name, dirty }) => [name, dirty] as const,
    )
    const sourceBytes = new Map(
      [...document.sourceParts].map(([name, part]) => [
        name,
        part.originalPayload.slice(),
      ]),
    )

    const json = serialiseModelJson(document)
    const parsed = parseModelJson(json)

    expect(parsed).toEqual(document.model)
    expect(parsed.stories.map(({ kind }) => kind)).toContain('header')
    expect(parsed.stories[0]?.paragraphs[0]?.id).toBe('para-w14-A1B2C3D4')
    expect(parsed.preservedXmlFragments).toEqual(
      document.model.preservedXmlFragments,
    )
    expect(
      [...document.sourceParts.values()].map(
        ({ name, dirty }) => [name, dirty] as const,
      ),
    ).toEqual(dirtyState)
    for (const [name, bytes] of sourceBytes) {
      expect(document.sourceParts.get(name)?.originalPayload).toEqual(bytes)
    }

    const stored = JSON.parse(json)
    expect(allKeys(stored)).not.toEqual(
      expect.arrayContaining([
        'sourceParts',
        'textRunAnchors',
        'dirty',
        'originalPayload',
      ]),
    )
  })

  it.each([
    ['malformed JSON', '{not-json'],
    ['an invalid wire value', JSON.stringify({ version: 1, stories: 'no' })],
  ])('returns a curated error for %s', (_name, json) => {
    try {
      parseModelJson(json)
      throw new Error('Expected model JSON parsing to fail.')
    } catch (error) {
      expect(error).toBeInstanceOf(OoxmlError)
      if (!(error instanceof OoxmlError)) return
      expect(error).toMatchObject({
        name: 'OoxmlError',
        code: 'invalid-model-json',
        message: 'The document model JSON is invalid.',
      })
      expect(error.message).not.toContain('stories')
    }
  })
})

function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys)
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([key, child]) => [
    key,
    ...allKeys(child),
  ])
}
