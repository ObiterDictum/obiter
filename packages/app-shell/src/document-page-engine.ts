import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { documentStory, paragraphPlainText } from './document-model-text'
import { takeFragment } from './document-page-flow'
import {
  drawingFloat,
  paragraphAnchorXml,
  resolveFloat,
  type PageFloat,
  type PageTextBox,
} from './document-page-floats'
import {
  contentFrame,
  documentPageBox,
  documentSectionXml,
  sectionColumns,
  type ColumnFrame,
  type ContentFrame,
  type PageBox,
} from './document-page-layout'
import { drawingSolidFill } from './document-page-media'
import { paragraphFace, paragraphLineHeightPx } from './document-page-style'
import {
  storyBlocks,
  type DisplayTable,
  type StoryBlock,
} from './document-page-tables'

export type { ContentFrame } from './document-page-layout'
export { contentFrame } from './document-page-layout'

export type LaidOutParagraph = {
  type: 'paragraph'
  paragraph: DocumentParagraphWire
  from?: number
  to?: number
  column?: number
  padLeftPx?: number
  padRightPx?: number
  continuation?: boolean
}

export type LaidOutTable = {
  type: 'table'
  table: DisplayTable
  column?: number
}

export type LaidOutBlock = LaidOutParagraph | LaidOutTable

export type LaidOutPage = {
  box: PageBox
  frame: ContentFrame
  columns: ColumnFrame[]
  blocks: LaidOutBlock[]
  floats: PageFloat[]
  textBoxes: PageTextBox[]
}

type Session = {
  page: LaidOutPage
  col: number
  y: number
}

export function layoutDocument(
  model: DocumentModelWire,
  drafts?: Record<string, string>,
): LaidOutPage[] {
  const box = documentPageBox(model)
  const frame = contentFrame(box)
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
  const source = storyBlocks(story).filter(
    (block) => block.type === 'table' || !boxed.has(block.paragraph.id),
  )
  const pages: LaidOutPage[] = []
  const session: Session = {
    page: emptyPage(box, frame, columns),
    col: 0,
    y: 0,
  }

  const column = () =>
    columns[session.col] ?? columns[0] ?? { left: 0, widthPx: frame.widthPx }

  const advance = () => {
    if (session.col + 1 < columns.length) {
      session.col += 1
      session.y = 0
      return
    }
    pages.push(session.page)
    session.page = emptyPage(box, frame, columns)
    session.col = 0
    session.y = 0
  }

  for (const item of source) {
    if (item.type === 'table') {
      const heightPx = tableHeight(item.table)
      if (session.y > 0 && heightPx > frame.heightPx - session.y) advance()
      session.page.blocks.push({
        type: 'table',
        table: item.table,
        column: session.col,
      })
      session.y += heightPx
      continue
    }
    layoutParagraph(
      item,
      model,
      drafts,
      hosts,
      box,
      frame,
      session,
      column,
      advance,
    )
  }

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

function layoutParagraph(
  item: Extract<StoryBlock, { type: 'paragraph' }>,
  model: DocumentModelWire,
  drafts: Record<string, string> | undefined,
  hosts: Set<string>,
  box: PageBox,
  frame: ContentFrame,
  session: Session,
  column: () => ColumnFrame,
  advance: () => void,
): void {
  const paragraph = item.paragraph
  const text = paragraphPlainText(paragraph, drafts)
  const face = paragraphFace(paragraph, model.styles)
  const linePx = paragraphLineHeightPx(face)
  const fontSize = face.run.fontSizePx ?? linePx
  const indent = (face.indentLeftPx ?? 0) + (face.indentRightPx ?? 0)
  let placed = false
  let offset = 0
  let continuation = false

  const place = () => {
    if (placed) return
    placeAnchors(paragraph, box, frame, column(), session)
    placed = true
  }

  if (hosts.has(paragraph.id) && !text.trim()) {
    place()
    return
  }

  while (offset < text.length || text.length === 0) {
    const before = continuation ? 0 : face.marginTopPx
    if (session.y > 0 && before + linePx > frame.heightPx - session.y) {
      advance()
      continue
    }
    place()
    const startY = session.y + before
    const fragment = takeFragment({
      text,
      offset,
      startY,
      maxY: frame.heightPx,
      linePx,
      fontSize,
      indent,
      column: column(),
      frame,
      floats: [...session.page.floats, ...session.page.textBoxes],
    })
    if (fragment.skipTo !== undefined && fragment.consumed === 0) {
      session.y = fragment.skipTo
      if (session.y >= frame.heightPx) advance()
      continue
    }
    if (fragment.consumed === 0 && text.length > 0) {
      if (session.y === 0) {
        offset += 1
        continue
      }
      advance()
      continue
    }
    const from = offset
    const to = text.length === 0 ? 0 : offset + fragment.consumed
    const continues = to < text.length
    session.page.blocks.push({
      type: 'paragraph',
      paragraph,
      from,
      to,
      column: session.col,
      padLeftPx: fragment.padLeftPx,
      padRightPx: fragment.padRightPx,
      continuation,
    })
    session.y =
      startY + fragment.heightPx + (continues ? 0 : face.marginBottomPx)
    offset = to
    continuation = true
    if (text.length === 0) break
  }
}

function placeAnchors(
  paragraph: DocumentParagraphWire,
  box: PageBox,
  frame: ContentFrame,
  column: ColumnFrame,
  session: Session,
): void {
  for (const xml of paragraphAnchorXml(paragraph)) {
    const spec = drawingFloat(xml, paragraph.id)
    if (!spec) continue
    const placed = resolveFloat(spec, box, frame, column, session.y)
    if (spec.isTextBox) {
      session.page.textBoxes.push({
        ...placed,
        paragraphIds: spec.textBoxParaIds,
        fill: drawingSolidFill(xml),
      })
    } else {
      session.page.floats.push(placed)
    }
  }
}

function tableHeight(table: DisplayTable): number {
  return table.rows.reduce((sum, row) => sum + (row.heightPx ?? 28), 0)
}

function emptyPage(
  box: PageBox,
  frame: ContentFrame,
  columns: ColumnFrame[],
): LaidOutPage {
  return { box, frame, columns, blocks: [], floats: [], textBoxes: [] }
}
