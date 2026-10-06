import type { DocumentModelWire, DocumentStoryWire } from '@obiter/contracts'
import {
  resolveInsertAnchor,
  storyFlowParagraphIds,
  type LocalInsert,
} from './document-edits'
import {
  documentStory,
  editableParagraphs,
  editableStoryOf,
} from './document-model-text'
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

/**
 * The story a flow id's order lives in — the paragraph's own editable story,
 * or, for a pending insert, the story its anchor chain resolves to. A margin
 * insert anchors on a header/footer paragraph, so it belongs to that story's
 * flow rather than the body's.
 */
export function editingStoryOfFlowId(
  model: DocumentModelWire,
  inserts: readonly LocalInsert[],
  id: string,
): DocumentStoryWire | undefined {
  const insert = inserts.find((item) => item.clientId === id)
  if (!insert) return editableStoryOf(model, id)
  const insertById = new Map(inserts.map((item) => [item.clientId, item]))
  const realIds = new Set(
    editableParagraphs(model).map((paragraph) => paragraph.id),
  )
  return editableStoryOf(
    model,
    resolveInsertAnchor(insert, insertById, realIds),
  )
}

/** `paragraphId`'s flow order inside its own story. */
export function storyFlowOrder(
  model: DocumentModelWire,
  inserts: readonly LocalInsert[],
  deletedParagraphIds: readonly string[],
  paragraphId: string,
): string[] {
  return storyFlowParagraphIds(
    editingStoryOfFlowId(model, inserts, paragraphId) ?? documentStory(model),
    inserts,
    deletedParagraphIds,
  )
}
