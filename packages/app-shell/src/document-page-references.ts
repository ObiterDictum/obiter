import type { DocumentModelWire } from '@obiter/contracts'

import type { LaidOutPage } from './document-page-blocks'

const BOOKMARK_NAME = /<w:bookmarkStart\b[^>]*\bw:name="([^"]+)"/gu

/**
 * The page each stored or folded bookmark resolves to, keyed by its
 * `w:name` — the map a `PAGEREF` instruction resolves through at paint.
 * Names come from `w:bookmarkStart` fragments on paragraph wires and runs
 * (paragraph-level preserved children are where the writers put them);
 * pages come from the same laid-out blocks the column renders, so a stored
 * or pending `TOC` entry and its `PAGE` twin agree on numbering. A
 * paragraph the layout skipped — inside a deleted block or a story page
 * the engine does not paginate — resolves to no page and paints nothing.
 */
export function pageReferenceMap(
  model: DocumentModelWire,
  pages: readonly LaidOutPage[],
): ReadonlyMap<string, number> {
  const pageOf = new Map<string, number>()
  pages.forEach((page, index) => {
    for (const block of page.blocks) {
      if (block.type === 'paragraph') {
        pageOf.set(block.paragraph.id, index + 1)
        continue
      }
      for (const row of block.table.rows) {
        for (const cell of row.cells) {
          for (const id of cell.paragraphIds) pageOf.set(id, index + 1)
        }
      }
    }
  })
  const references = new Map<string, number>()
  for (const story of model.stories) {
    for (const paragraph of story.paragraphs) {
      const page = pageOf.get(paragraph.id)
      if (page === undefined) continue
      const fragments = [
        ...paragraph.preservedXmlFragments,
        ...paragraph.runs.flatMap((run) => run.preservedXmlFragments),
      ]
      for (const fragment of fragments) {
        for (const match of fragment.matchAll(BOOKMARK_NAME)) {
          const name = match[1]
          if (name !== undefined) references.set(name, page)
        }
      }
    }
  }
  return references
}
