import type { DocumentStoryWire } from '@obiter/contracts'
import { drawingFloat, paragraphAnchorXml } from './document-page-floats'
import { storyBlocks } from './document-page-tables'

/**
 * The paragraphs a story flows as ordinary body text: everything outside a
 * table, and nothing hosted by a text box (those render in a page overlay at
 * an absolute position, not at their story position). A document selection may
 * only cover these, and a range edit may not cross a paragraph that is not one.
 * The document's table binding is the owner of that partition, so the
 * selection does not re-derive it from the XML.
 */
export function storyBodyParagraphIds(story: DocumentStoryWire): Set<string> {
  const hosted = new Set<string>()
  for (const paragraph of story.paragraphs) {
    for (const xml of paragraphAnchorXml(paragraph)) {
      const spec = drawingFloat(xml, paragraph.id)
      if (!spec) continue
      for (const id of spec.textBoxParaIds) hosted.add(id)
    }
  }
  const body = new Set<string>()
  for (const block of storyBlocks(story)) {
    if (block.type !== 'paragraph') continue
    if (hosted.has(block.paragraph.id)) continue
    body.add(block.paragraph.id)
  }
  return body
}
