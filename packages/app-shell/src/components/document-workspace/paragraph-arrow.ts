import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import {
  flowParagraphIds,
  insertPlainText,
  type LocalInsert,
} from '../../document-edits'
import { paragraphPlainText } from '../../document-model-text'
import { wrapLines, type WrappedLine } from '../../document-page-flow'
import { paragraphFace } from '../../document-page-style'

export type ArrowNeighbor = {
  id: string
  text: string
  lines: WrappedLine[]
}

export function offsetAfterArrow(input: {
  key: string
  offset: number
  text: string
  lines: WrappedLine[]
  previous?: ArrowNeighbor
  next?: ArrowNeighbor
}): { paragraphId: string; offset: number } | undefined {
  const { key, offset, text, lines, previous, next } = input
  const index = lineIndex(lines, offset)
  const origin = lines[index]
  const column = origin ? offset - origin.from : offset
  if (key === 'ArrowLeft' && offset === 0 && previous) {
    return { paragraphId: previous.id, offset: previous.text.length }
  }
  if (key === 'ArrowRight' && offset >= text.length && next) {
    return { paragraphId: next.id, offset: 0 }
  }
  if (key === 'ArrowUp' && index <= 0 && previous) {
    return {
      paragraphId: previous.id,
      offset: offsetOnLine(previous.lines[previous.lines.length - 1], column),
    }
  }
  if (key === 'ArrowDown' && index >= lines.length - 1 && next) {
    return {
      paragraphId: next.id,
      offset: offsetOnLine(next.lines[0], column),
    }
  }
}

function lineIndex(lines: WrappedLine[], offset: number): number {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line) continue
    const last = index === lines.length - 1
    if (offset < line.to || last) return index
  }
  return Math.max(0, lines.length - 1)
}

function offsetOnLine(line: WrappedLine | undefined, column: number): number {
  if (!line) return column
  return Math.min(line.from + column, line.to)
}

export function arrowNeighbors(
  ctx: {
    model: DocumentModelWire
    drafts?: Record<string, string>
    inserts: LocalInsert[]
    deletedParagraphIds: string[]
    paragraphs: DocumentParagraphWire[]
  },
  paragraphId: string,
  wrapWidthPx?: number,
): { previous?: ArrowNeighbor; next?: ArrowNeighbor } {
  const order = flowParagraphIds(
    ctx.model,
    ctx.inserts,
    ctx.deletedParagraphIds,
  )
  const index = order.indexOf(paragraphId)
  return {
    previous: arrowNeighbor(order[index - 1], ctx, wrapWidthPx),
    next: arrowNeighbor(order[index + 1], ctx, wrapWidthPx),
  }
}

function arrowNeighbor(
  id: string | undefined,
  ctx: {
    model: DocumentModelWire
    drafts?: Record<string, string>
    inserts: LocalInsert[]
    paragraphs: DocumentParagraphWire[]
  },
  wrapWidthPx?: number,
): ArrowNeighbor | undefined {
  if (!id) return undefined
  const insert = ctx.inserts.find((item) => item.clientId === id)
  const paragraph = ctx.paragraphs.find((item) => item.id === id)
  const text = insert
    ? insertPlainText(insert)
    : paragraph
      ? paragraphPlainText(paragraph, ctx.drafts)
      : ''
  const face = paragraph
    ? paragraphFace(paragraph, ctx.model.styles)
    : undefined
  const fontSizePx = face?.run.fontSizePx ?? 16
  const lines =
    wrapWidthPx && wrapWidthPx > 0
      ? wrapLines(text, fontSizePx, wrapWidthPx, face?.run.fontFamily)
      : [{ text, from: 0, to: text.length }]
  return { id, text, lines }
}
