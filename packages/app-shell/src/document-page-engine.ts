import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { insertRuns, type LocalInsert } from './document-edits'
import type { ExtraRuns } from './document-word-edits'
import { documentStory, paragraphPlainText } from './document-model-text'
import { takeFragment } from './document-page-flow'
import { drawingScene } from './document-page-drawings'
import { keepWithNext, paragraphMetrics, widowMaxY } from './document-page-keep'
import {
  drawingFloat,
  paragraphAnchorXml,
  paragraphInlineXml,
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
import { marginBandHeights } from './document-page-margin'
import { paragraphListIndent } from './document-page-lists'
import { documentNotes } from './document-page-notes'
import { paragraphFace, paragraphLineHeightPx } from './document-page-style'
import {
  storyBlocks,
  rowPaintHeight,
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
  wrapWidthPx?: number
  continuation?: boolean
  pageStart?: boolean
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
  broken: boolean
}

export function layoutDocument(
  model: DocumentModelWire,
  drafts?: Record<string, string>,
  inserts: LocalInsert[] = [],
  extraRuns: ExtraRuns = {},
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
    storyBlocks(story).filter(
      (block) => block.type === 'table' || !boxed.has(block.paragraph.id),
    ),
    inserts,
  )
  const pages: LaidOutPage[] = []
  const session: Session = {
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
  session: Session,
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

function layoutParagraph(
  item: Extract<StoryBlock, { type: 'paragraph' }>,
  model: DocumentModelWire,
  drafts: Record<string, string> | undefined,
  extraRuns: ExtraRuns,
  hosts: Set<string>,
  box: PageBox,
  frame: ContentFrame,
  session: Session,
  column: () => ColumnFrame,
  advance: () => void,
): void {
  const paragraph = {
    ...item.paragraph,
    runs: [...item.paragraph.runs, ...(extraRuns[item.paragraph.id] ?? [])].map(
      (run) => ({
        ...run,
        text: drafts?.[run.id] ?? run.text,
      }),
    ),
  }
  const text = paragraphPlainText(paragraph)
  const face = paragraphFace(paragraph, model.styles)
  const linePx = paragraphLineHeightPx(face)
  const fontSize = face.run.fontSizePx ?? linePx
  const list = paragraphListIndent(paragraph, model)
  const indent =
    (list?.leftPx ?? face.indentLeftPx ?? 0) + (face.indentRightPx ?? 0)
  const imagePx = Math.max(
    0,
    ...paragraphInlineXml(paragraph).map((xml) => drawingScene(xml).heightPx),
  )
  let placed = false
  let offset = 0
  let continuation = false

  const place = () => {
    if (placed) return
    placeAnchors(paragraph, box, frame, column(), session)
    placed = true
  }

  if (hasPageBreak(paragraph) && session.y > 0) advance()

  if (imagePx > 0) {
    if (session.y > 0 && imagePx + linePx > frame.heightPx - session.y) {
      advance()
    }
    place()
    session.y += imagePx
    if (!text.trim()) return
  }

  if (hosts.has(paragraph.id) && !text.trim()) {
    place()
    return
  }

  while (offset < text.length || text.length === 0) {
    const pageStart = session.y === 0 && session.broken && !continuation
    const before = continuation || pageStart ? 0 : face.marginTopPx
    const remaining = frame.heightPx - session.y
    const needed =
      before + linePx + (text.length === 0 ? face.marginBottomPx : 0)
    if (
      session.y > 0 &&
      (continuation ? needed > remaining : needed >= remaining)
    ) {
      advance()
      continue
    }
    place()
    const startY = session.y + before
    const fragment = takeFragment({
      text,
      offset,
      startY,
      maxY: widowMaxY(
        face.widowControl !== false,
        text,
        offset,
        startY,
        frame.heightPx,
        linePx,
        fontSize,
        Math.max(1, column().widthPx - indent),
        session.y > 0 && !continuation,
        face.run.fontFamily,
      ),
      linePx,
      fontSize,
      fontFamily: face.run.fontFamily,
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
    const used = fragment.heightPx + (continues ? 0 : face.marginBottomPx)
    if (
      session.y > 0 &&
      (continuation
        ? startY + used > frame.heightPx
        : startY + used >= frame.heightPx)
    ) {
      advance()
      placed = false
      continue
    }
    session.page.blocks.push({
      type: 'paragraph',
      paragraph,
      from,
      to,
      column: session.col,
      padLeftPx: fragment.padLeftPx,
      padRightPx: fragment.padRightPx,
      wrapWidthPx: Math.max(
        1,
        column().widthPx - indent - fragment.padLeftPx - fragment.padRightPx,
      ),
      continuation,
      pageStart,
    })
    session.y = startY + used
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

function withInserts(
  blocks: StoryBlock[],
  inserts: LocalInsert[],
): StoryBlock[] {
  if (inserts.length === 0) return blocks
  const byAfter = new Map<string, LocalInsert[]>()
  for (const insert of inserts) {
    const list = byAfter.get(insert.afterParagraphId) ?? []
    list.push(insert)
    byAfter.set(insert.afterParagraphId, list)
  }
  const result: StoryBlock[] = []
  const append = (id: string) => {
    for (const insert of byAfter.get(id) ?? []) {
      result.push({
        type: 'paragraph',
        paragraph: {
          id: insert.clientId,
          runs: insertRuns(insert),
          preservedXmlFragments: [],
        },
      })
      append(insert.clientId)
    }
  }
  for (const block of blocks) {
    result.push(block)
    if (block.type === 'paragraph') append(block.paragraph.id)
    else {
      for (const id of block.table.paragraphIds) append(id)
    }
  }
  return result
}

function hasPageBreak(paragraph: DocumentParagraphWire): boolean {
  const xml = [
    ...paragraph.preservedXmlFragments,
    ...paragraph.runs.flatMap((run) => run.preservedXmlFragments),
  ].join('')
  if (/<w:br\b[^>]*w:type="page"/i.test(xml)) return true
  const before = xml.match(/<w:pageBreakBefore\b([^>]*)\/?>/i)
  if (!before) return false
  const val = before[1]?.match(/w:val="([^"]+)"/i)?.[1]?.toLowerCase()
  return val !== 'false' && val !== '0' && val !== 'off'
}

function tableHeight(
  table: DisplayTable,
  model: DocumentModelWire,
  drafts: Record<string, string> | undefined,
  extraRuns: ExtraRuns,
  widthPx: number,
): number {
  const paras = new Map(
    (documentStory(model)?.paragraphs ?? []).map((paragraph) => [
      paragraph.id,
      paragraph,
    ]),
  )
  return table.rows.reduce((sum, row) => {
    const cellWidth = Math.max(1, widthPx / Math.max(1, row.cells.length))
    const content = Math.max(
      0,
      ...row.cells.map((cell) =>
        cell.paragraphIds.reduce((height, id) => {
          const paragraph = paras.get(id)
          if (!paragraph) return height
          return (
            height +
            paragraphMetrics(paragraph, model, drafts, extraRuns, cellWidth)
              .heightPx
          )
        }, 0),
      ),
    )
    return sum + Math.max(rowPaintHeight(row), content)
  }, 0)
}

function emptyPage(
  box: PageBox,
  frame: ContentFrame,
  columns: ColumnFrame[],
): LaidOutPage {
  return { box, frame, columns, blocks: [], floats: [], textBoxes: [] }
}
