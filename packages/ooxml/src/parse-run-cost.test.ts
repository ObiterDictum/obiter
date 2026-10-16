import { describe, expect, it } from 'bun:test'

import { parseDocx } from './parse'
import { probePackage, W } from './share-safe-probe-kit'

/**
 * The story walk and the field pairing must be linear in a part's element
 * count. Both used to scan the whole element list once per paragraph, per run
 * and per field, so a field-bearing document cost paragraphs × elements: 1,000
 * field paragraphs took ~4.7 s and 4,000 took ~95 s. A part this size now
 * parses in well under a second, so a fixed bound is the assertion — the old
 * shape needs minutes (a plain ratio between two sizes is the weaker check and
 * catches it only narrowly, so both are here).
 */
function fieldHeavyDocument(paragraphs: number) {
  const body = Array.from(
    { length: paragraphs },
    (_, index) =>
      `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> REF b${index} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t>text ${index}</w:t></w:r></w:p>`,
  ).join('')
  return `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
}

describe('field-heavy part cost', () => {
  it('parses a part of 8000 field paragraphs in linear time', async () => {
    const bytes = await probePackage({
      document: fieldHeavyDocument(8000),
    })
    const started = Date.now()
    const document = await parseDocx(bytes)
    // ~0.9 s linear; the old shape takes minutes, so the bound is wide.
    expect(Date.now() - started).toBeLessThan(5_000)
    const story = document.model.stories[0]
    expect(story?.paragraphs).toHaveLength(8000)
    expect(story?.fields).toHaveLength(8000)
    expect(document.textRunAnchors.size).toBe(8000 * 4)
  })

  it('pairs fields without scanning the part per field', async () => {
    // Compare a small and a large part: the per-field cost must not grow with
    // the part, so the large one is not materially more than 4× the small one
    // (linear) rather than ~16× (quadratic). The margin is wide because this
    // measures work, not a guarantee.
    const small = await fieldScanMs(1000)
    const large = await fieldScanMs(4000)
    expect(large).toBeLessThan(Math.max(small, 1) * 12)
  })
})

async function fieldScanMs(paragraphs: number) {
  const bytes = await probePackage({ document: fieldHeavyDocument(paragraphs) })
  const started = Date.now()
  await parseDocx(bytes)
  return Date.now() - started
}
