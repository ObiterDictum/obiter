import { describe, expect, it } from 'bun:test'

import { validateCommentAnchor } from './index'
import { fixtureDocument } from './comments-export.test-support'

describe('comment anchor validation', () => {
  it('refuses an anchor whose end paragraph lives in another story', async () => {
    const document = await fixtureDocument()
    const body = document.model.stories.find(
      (story) => story.kind === 'document',
    )?.paragraphs[0]
    const header = document.model.stories.find(
      (story) => story.kind === 'header',
    )?.paragraphs[0]
    if (!body || !header) throw new Error('Fixture paragraphs are missing.')

    expect(() =>
      validateCommentAnchor(document.model, {
        paragraphId: body.id,
        startOffset: 0,
        endParagraphId: header.id,
        endOffset: 0,
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'comment-anchor-unresolved' }),
    )
  })

  it('refuses an anchor whose paragraph id is not unique', async () => {
    const document = await fixtureDocument()
    const body = document.model.stories.find(
      (story) => story.kind === 'document',
    )?.paragraphs[0]
    const header = document.model.stories.find(
      (story) => story.kind === 'header',
    )
    if (!body || !header) throw new Error('Fixture paragraphs are missing.')
    const model = structuredClone(document.model)
    const duplicated = model.stories.find((story) => story.kind === 'header')
    if (!duplicated) throw new Error('Fixture header story is missing.')
    duplicated.paragraphs.push(structuredClone(body))

    expect(() =>
      validateCommentAnchor(model, {
        paragraphId: body.id,
        startOffset: 0,
        endOffset: 0,
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'comment-anchor-unresolved' }),
    )
  })
})
