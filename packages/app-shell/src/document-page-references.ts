import type { DocumentModelWire } from '@obiter/contracts'

import type { LaidOutPage } from './document-page-blocks'

const BOOKMARK_NAME = /<w:bookmarkStart\b[^>]*\bw:name="([^"]+)"/gu

export function pageReferenceMap(
  model: DocumentModelWire,
  pages: readonly LaidOutPage[],
): ReadonlyMap<string, number> {
  const pageOf = new Map<string, number>()
  pages.forEach((page, index) => {
    for (const block of page.blocks) {
      if (block.type === 'paragraph') {
        if (!pageOf.has(block.paragraph.id)) {
          pageOf.set(block.paragraph.id, index + 1)
        }
        continue
      }
      for (const row of block.table.rows) {
        for (const cell of row.cells) {
          for (const id of cell.paragraphIds) {
            if (!pageOf.has(id)) pageOf.set(id, index + 1)
          }
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
