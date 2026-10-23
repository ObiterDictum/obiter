import { expect, it } from 'bun:test'
import { createBlankDocx, parseDocx } from '@obiter/ooxml'
import type { DocumentChangeWire } from '@obiter/contracts'
import { layoutDocument } from './document-page-engine'

async function measure(count: number, perParagraph: number) {
  const { model } = await parseDocx(await createBlankDocx())
  const story = model.stories[0]
  if (!story) throw new Error('Missing body story')
  story.paragraphs = Array.from({ length: count }, (_, n) => ({
    id: `p${n}`,
    runs: [{ id: `r${n}`, text: 'Ordinary text ', preservedXmlFragments: [] }],
    preservedXmlFragments: [],
  }))
  let paragraphReads = 0
  model.changes = story.paragraphs.flatMap((p) =>
    Array.from({ length: perParagraph }, (_, n): DocumentChangeWire => ({
      id: `${p.id}-c${n}`,
      get paragraphId() {
        paragraphReads += 1
        return p.id
      },
      storyPartName: story.partName,
      kind: 'insert',
      elementName: 'ins',
      text: 'revision ',
      inlinePosition: { beforeRunId: null },
    })),
  )
  const pages = layoutDocument(model)
  expect(
    pages
      .flatMap((page) => page.blocks)
      .filter((block) => block.type === 'paragraph'),
  ).toHaveLength(count)
  return { paragraphReads, changes: model.changes.length }
}
it('bounds layout cost as both paragraph and revision counts grow', async () => {
  await measure(100, 10)
  const small = await measure(500, 10)
  const large = await measure(2000, 20)
  // Count input reads instead of asserting wall time on the shared CI host.
  // The old per-paragraph filter reads every change for every paragraph.
  expect(small.paragraphReads).toBeLessThanOrEqual(small.changes * 4)
  expect(large.paragraphReads).toBeLessThanOrEqual(large.changes * 4)
})
