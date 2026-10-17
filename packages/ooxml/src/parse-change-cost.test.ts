import { describe, expect, it } from 'bun:test'

import { parseDocx } from './parse'
import { probePackage, W } from './share-safe-probe-kit'

/**
 * Reading a part's tracked changes and its move ranges must be linear in the
 * part's element count.
 *
 * Both used to answer a question per change by walking the whole part: which
 * elements a change contains, which paragraph is the smallest one holding it,
 * whether a move container is clean, and which container a wrapper belongs to.
 * A part with many changes or many moves therefore cost changes × elements.
 * Measured on the shape each test builds:
 *
 * | workload | before | after |
 * | --- | --- | --- |
 * | 1,000 tracked changes | 329 ms | 115 ms |
 * | 2,000 tracked changes | 991 ms | 145 ms |
 * | 4,000 tracked changes | 3,631 ms | 277 ms |
 * | 1,000 moves | 1,371 ms | 165 ms |
 * | 2,000 moves | 6,018 ms | 294 ms |
 * | 4,000 moves | (→ ~22 s) | 607 ms |
 *
 * A fixed bound is the assertion, because the old shape needs seconds where the
 * new one needs tens of milliseconds; each test also times two sizes, since a
 * ratio catches a term the fixed bound would forgive on a smaller part.
 */
const ins = (index: number) =>
  `<w:ins w:id="${index}" w:author="A" w:date="2024-01-01T00:00:00Z"><w:r><w:t>text ${index}</w:t></w:r></w:ins>`

/** A change per paragraph, each with its own run and text. */
function changeDocument(count: number) {
  const body = Array.from(
    { length: count },
    (_, index) =>
      `<w:p><w:r><w:t>before ${index} </w:t></w:r>${ins(index)}</w:p>`,
  ).join('')
  return `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
}

/** A paired move per paragraph: range markers around each wrapper, so the
 * container path runs rather than the uncontainered fallback. */
function moveDocument(count: number) {
  const body = Array.from(
    { length: count },
    (_, index) =>
      `<w:p><w:moveFromRangeStart w:id="${index}" w:name="mv${index}"/>` +
      `<w:moveFrom w:id="${index}" w:author="A" w:date="2024-01-01T00:00:00Z"><w:r><w:t>moved ${index}</w:t></w:r></w:moveFrom>` +
      `<w:moveFromRangeEnd w:id="${index}"/>` +
      `<w:moveToRangeStart w:id="${index}" w:name="mv${index}"/>` +
      `<w:moveTo w:id="${index}" w:author="A" w:date="2024-01-01T00:00:00Z"><w:r><w:t>moved ${index}</w:t></w:r></w:moveTo>` +
      `<w:moveToRangeEnd w:id="${index}"/></w:p>`,
  ).join('')
  return `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
}

async function timeParse(make: (count: number) => string, count: number) {
  const bytes = await probePackage({ document: make(count) })
  const started = Date.now()
  const document = await parseDocx(bytes)
  return { elapsed: Date.now() - started, document }
}

describe('change-heavy part cost', () => {
  it('parses 4000 tracked changes well inside a second', async () => {
    const { elapsed, document } = await timeParse(changeDocument, 4_000)
    const story = document.model.stories[0]
    expect(story?.paragraphs).toHaveLength(4_000)
    // The part keeps the changes it modelled: one ins per paragraph.
    expect(document.model.changes.length).toBeGreaterThanOrEqual(4_000)
    expect(elapsed).toBeLessThan(2_000)
  })

  it('reads tracked changes without growing with their square', async () => {
    // 8x the changes must not cost 64x the time, which is what a per-change walk
    // of the part does.
    const small = await timeParse(changeDocument, 500)
    const large = await timeParse(changeDocument, 4_000)
    expect(large.elapsed).toBeLessThan(Math.max(150, small.elapsed * 24))
  })

  it('parses 2000 moves well inside a second', async () => {
    const { elapsed, document } = await timeParse(moveDocument, 2_000)
    const story = document.model.stories[0]
    expect(story?.paragraphs).toHaveLength(2_000)
    expect(document.model.changes.length).toBeGreaterThanOrEqual(4_000)
    expect(elapsed).toBeLessThan(2_000)
  })

  it('reads move ranges without growing with their square', async () => {
    const small = await timeParse(moveDocument, 250)
    const large = await timeParse(moveDocument, 2_000)
    expect(large.elapsed).toBeLessThan(Math.max(150, small.elapsed * 24))
  })
})
