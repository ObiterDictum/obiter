import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { paragraphPlainText } from './document-model-text'
import type { ExtraRuns } from './document-word-edits'
import { countLines } from './document-page-flow'
import type { ColumnFrame, ContentFrame } from './document-page-layout'
import { paragraphListIndent } from './document-page-lists'
import { paragraphFace, paragraphLineHeightPx } from './document-page-style'
import type { StoryBlock } from './document-page-tables'

export function keepWithNext(
  source: StoryBlock[],
  index: number,
  model: DocumentModelWire,
  drafts: Record<string, string> | undefined,
  extraRuns: ExtraRuns,
  frame: ContentFrame,
  column: ColumnFrame,
  session: { y: number },
  advance: () => void,
): void {
  if (session.y === 0) return
  const remaining = frame.heightPx - session.y
  let heightPx = 0
  let first: ReturnType<typeof paragraphMetrics> | undefined
  for (let cursor = index; cursor < source.length; cursor += 1) {
    const block = source[cursor]
    if (block.type !== 'paragraph') break
    const next = paragraphMetrics(
      block.paragraph,
      model,
      drafts,
      extraRuns,
      column.widthPx,
    )
    if (!first) first = next
    heightPx += next.heightPx
    if (!next.keepNext) break
  }
  if (!first) return
  if (
    first.keepLines &&
    first.heightPx <= frame.heightPx &&
    first.heightPx > remaining
  ) {
    advance()
    return
  }
  if (first.keepNext && heightPx <= frame.heightPx && heightPx > remaining) {
    advance()
    return
  }
  if (
    first.widowControl &&
    first.lineCount >= 2 &&
    remaining < 2 * first.linePx &&
    first.heightPx > remaining
  ) {
    advance()
  }
}

export function widowMaxY(
  widowControl: boolean,
  text: string,
  offset: number,
  startY: number,
  pageMaxY: number,
  linePx: number,
  fontSize: number,
  widthPx: number,
  orphanCheck: boolean,
  fontFamily?: string,
): number {
  if (!widowControl) return pageMaxY
  const remainingLines = countLines(
    text.slice(offset),
    fontSize,
    widthPx,
    fontFamily,
  )
  const fit = Math.max(0, Math.floor((pageMaxY - startY) / linePx))
  if (orphanCheck && fit === 1 && remainingLines > 1) return startY
  if (fit >= 2 && remainingLines - fit === 1) return startY + (fit - 1) * linePx
  if (fit === 1 && remainingLines === 2) return startY
  return pageMaxY
}

export function paragraphMetrics(
  paragraph: DocumentParagraphWire,
  model: DocumentModelWire,
  drafts: Record<string, string> | undefined,
  extraRuns: ExtraRuns,
  columnWidthPx: number,
) {
  const resolved = {
    ...paragraph,
    runs: [...paragraph.runs, ...(extraRuns[paragraph.id] ?? [])].map(
      (run) => ({
        ...run,
        text: drafts?.[run.id] ?? run.text,
      }),
    ),
  }
  const text = paragraphPlainText(resolved)
  const face = paragraphFace(resolved, model.styles)
  const linePx = paragraphLineHeightPx(face)
  const fontSize = face.run.fontSizePx ?? linePx
  const list = paragraphListIndent(resolved, model)
  const indent =
    (list?.leftPx ?? face.indentLeftPx ?? 0) + (face.indentRightPx ?? 0)
  const lineCount = countLines(
    text,
    fontSize,
    Math.max(1, columnWidthPx - indent),
    face.run.fontFamily,
  )
  return {
    linePx,
    lineCount,
    heightPx: face.marginTopPx + lineCount * linePx + face.marginBottomPx,
    keepNext: face.keepNext === true,
    keepLines: face.keepLines === true,
    widowControl: face.widowControl !== false,
  }
}
