import type { PendingRedlines } from './document-pending-redlines'
import type { DocumentModelWire } from '@obiter/contracts'
import type { ExtraRuns } from './document-word-edits'
import type { ColumnFrame, ContentFrame } from './document-page-layout'
import { paragraphMetrics } from './document-page-measure'
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
  pendingRedlines?: PendingRedlines,
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
      pendingRedlines,
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
  lineCount: (offset: number) => number,
  offset: number,
  startY: number,
  pageMaxY: number,
  linePx: number,
  orphanCheck: boolean,
): number {
  if (!widowControl) return pageMaxY
  const remainingLines = lineCount(offset)
  const fit = Math.max(0, Math.floor((pageMaxY - startY) / linePx))
  if (orphanCheck && fit === 1 && remainingLines > 1) return startY
  if (fit >= 2 && remainingLines - fit === 1) return startY + (fit - 1) * linePx
  if (fit === 1 && remainingLines === 2) return startY
  return pageMaxY
}
