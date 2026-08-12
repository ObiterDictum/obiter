import { describe, expect, it } from 'vitest'
import { createBlankDocx } from './blank'
import { parseDocx } from './parse'

describe('createBlankDocx', () => {
  it('parses to a document story with one empty paragraph', async () => {
    const document = await parseDocx(await createBlankDocx())
    const story = document.model.stories.find(
      (item) => item.kind === 'document',
    )
    expect(story?.paragraphs).toHaveLength(1)
    expect(story?.paragraphs[0]?.runs[0]?.text).toBe('')
  })
})
