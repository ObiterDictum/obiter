import { describe, expect, it } from 'bun:test'

import { parseDocx } from './parse'
import { probePackage, W } from './share-safe-probe-kit'

/**
 * The pairing walks a part's elements with binary-searched windows rather than
 * whole-list scans. These pin the windows' edges.
 */
function fieldDocument(inner: string) {
  return `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${inner}</w:body></w:document>`
}

const complexField = (instruction: string) =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> ${instruction} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`

describe('field spans', () => {
  it('names a field that spans paragraphs', async () => {
    const document = await parseDocx(
      await probePackage({
        document: fieldDocument(
          `<w:p>${complexField('REF a')}</w:p><w:p><w:r><w:t>tail</w:t></w:r></w:p>`,
        ),
      }),
    )
    const story = document.model.stories[0]
    expect(story?.fields).toHaveLength(1)
    expect(story?.fields[0]?.paragraphIds).toEqual([story?.paragraphs[0]?.id])
  })

  it('names the root paragraph when the part root is the paragraph itself', async () => {
    // Malformed on purpose: the part's root is the `w:p`, so the paragraph has
    // no parent and the sibling window cannot be built from one. The span must
    // still name the paragraph rather than report none.
    const document = await parseDocx(
      await probePackage({
        document: `<?xml version="1.0"?><w:p xmlns:w="${W}">${complexField('REF a')}</w:p>`,
      }),
    )
    const story = document.model.stories[0]
    expect(story?.paragraphs).toHaveLength(1)
    expect(story?.fields).toHaveLength(1)
    expect(story?.fields[0]?.paragraphIds).toEqual([story?.paragraphs[0]?.id])
  })

  it('pairs a simple field in the paragraph that carries it', async () => {
    const document = await parseDocx(
      await probePackage({
        document: fieldDocument(
          `<w:p><w:fldSimple w:instr=" REF a "><w:r><w:t>x</w:t></w:r></w:fldSimple></w:p>`,
        ),
      }),
    )
    const story = document.model.stories[0]
    expect(story?.fields).toHaveLength(1)
    expect(story?.fields[0]?.paragraphIds).toEqual([story?.paragraphs[0]?.id])
  })
})
