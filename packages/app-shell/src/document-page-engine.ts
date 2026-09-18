import type { DocumentModelWire } from '@obiter/contracts'
import { flowIds, insertRuns, type LocalInsert } from './document-edits'
import type { ExtraRuns } from './document-word-edits'
import { documentStory } from './document-model-text'
import { keepWithNext } from './document-page-keep'
import { drawingFloat, paragraphAnchorXml } from './document-page-floats'
import {
  contentFrame,
  documentPageBox,
  documentSectionXml,
  sectionColumns,
  type ColumnFrame,
  type ContentFrame,
  type PageBox,
} from './document-page-layout'
import { marginBandHeights } from './document-page-margin'
import { documentNotes } from './document-page-notes'
import { storyBlocks, type StoryBlock } from './document-page-tables'
import {
  emptyPage,
  layoutParagraph,
  tableHeight,
  type LaidOutPage,
  type PageSession,
} from './document-page-blocks'

export type { ContentFrame } from './document-page-layout'
export { contentFrame } from './document-page-layout'
export type {
  LaidOutBlock,
  LaidOutPage,
  LaidOutParagraph,
  LaidOutTable,
} from './document-page-blocks'

export function layoutDocument(
  model: DocumentModelWire,
  drafts?: Record<string, string>,
  inserts: LocalInsert[] = [],
  extraRuns: ExtraRuns = {},
  /** The document story's blocks, when the caller already holds them. They are
   * a pure function of the model, so re-deriving them inside every pagination
   * pass re-parsed the table structure on each keystroke for no change. */
  blocks?: StoryBlock[],
): LaidOutPage[] {
  const box = documentPageBox(model)
  const frame = contentFrame(box, marginBandHeights(model))
  const columns = sectionColumns(box, documentSectionXml(model))
  const story = documentStory(model)
  if (!story || story.paragraphs.length === 0) {
    return [emptyPage(box, frame, columns)]
  }

  const boxed = new Set<string>()
  const hosts = new Set<string>()
  for (const paragraph of story.paragraphs) {
    for (const xml of paragraphAnchorXml(paragraph)) {
      const spec = drawingFloat(xml, paragraph.id)
      if (!spec) continue
      hosts.add(paragraph.id)
      for (const id of spec.textBoxParaIds) boxed.add(id)
    }
  }
  const source = withInserts(
    (blocks ?? storyBlocks(story)).filter(
      (block) => block.type === 'table' || !boxed.has(block.paragraph.id),
    ),
    inserts,
  )
  const pages: LaidOutPage[] = []
  const session: PageSession = {
    page: emptyPage(box, frame, columns),
    col: 0,
    y: 0,
    broken: false,
  }

  const column = () =>
    columns[session.col] ?? columns[0] ?? { left: 0, widthPx: frame.widthPx }

  const advance = () => {
    if (session.col + 1 < columns.length) {
      session.col += 1
      session.y = 0
      session.broken = true
      return
    }
    pages.push(session.page)
    session.page = emptyPage(box, frame, columns)
    session.col = 0
    session.y = 0
    session.broken = true
  }

  for (let index = 0; index < source.length; index += 1) {
    const item = source[index]
    if (item.type === 'table') {
      const heightPx = tableHeight(
        item.table,
        model,
        drafts,
        extraRuns,
        column().widthPx,
      )
      if (session.y > 0 && heightPx > frame.heightPx - session.y) advance()
      session.page.blocks.push({
        type: 'table',
        table: item.table,
        column: session.col,
      })
      session.y += heightPx
      if (session.y >= frame.heightPx) advance()
      continue
    }
    keepWithNext(
      source,
      index,
      model,
      drafts,
      extraRuns,
      frame,
      column(),
      session,
      advance,
    )
    layoutParagraph(
      item,
      model,
      drafts,
      extraRuns,
      hosts,
      box,
      frame,
      session,
      column,
      advance,
    )
  }

  layoutNotes(
    model,
    drafts,
    extraRuns,
    hosts,
    box,
    frame,
    session,
    column,
    advance,
  )

  if (
    session.page.blocks.length > 0 ||
    session.page.floats.length > 0 ||
    session.page.textBoxes.length > 0 ||
    pages.length === 0
  ) {
    pages.push(session.page)
  }
  return pages
}

function layoutNotes(
  model: DocumentModelWire,
  drafts: Record<string, string> | undefined,
  extraRuns: ExtraRuns,
  hosts: Set<string>,
  box: PageBox,
  frame: ContentFrame,
  session: PageSession,
  column: () => ColumnFrame,
  advance: () => void,
): void {
  const notes = documentNotes(model)
  if (notes.length === 0) return
  if (session.y > 0) {
    session.y += 12
  }
  for (const note of notes) {
    for (const paragraph of note.paragraphs) {
      layoutParagraph(
        { type: 'paragraph', paragraph },
        model,
        drafts,
        extraRuns,
        hosts,
        box,
        frame,
        session,
        column,
        advance,
      )
    }
  }
}

function withInserts(
  blocks: StoryBlock[],
  inserts: LocalInsert[],
): StoryBlock[] {
  if (inserts.length === 0) return blocks
  const insertById = new Map(inserts.map((item) => [item.clientId, item]))
  const hostIds: string[] = []
  const hostBlock = new Map<string, StoryBlock>()
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      hostIds.push(block.paragraph.id)
      hostBlock.set(block.paragraph.id, block)
    } else {
      for (const id of block.table.paragraphIds) {
        hostIds.push(id)
        hostBlock.set(id, block)
      }
    }
  }
  const seen = new Set<StoryBlock>()
  const result: StoryBlock[] = []
  for (const id of flowIds(hostIds, inserts)) {
    const insert = insertById.get(id)
    if (insert) {
      result.push({
        type: 'paragraph',
        paragraph: {
          id: insert.clientId,
          runs: insertRuns(insert),
          preservedXmlFragments: [],
        },
      })
      continue
    }
    const block = hostBlock.get(id)
    if (!block || seen.has(block)) continue
    seen.add(block)
    result.push(block)
  }
  return result
}
