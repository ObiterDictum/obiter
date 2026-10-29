import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import {
  flowParagraphIds,
  insertPlainText,
  type LocalInsert,
} from '../../document-edits'
import {
  effectiveParagraph,
  paragraphPlainText,
} from '../../document-model-text'
import type { ExtraRuns } from '../../document-word-edits'
import { revisionOnlyParagraph } from '../../document-inline-index'
import {
  firstLineIndentPx,
  wrapLines,
  type WrappedLine,
} from '../../document-page-flow'
import { paragraphFace } from '../../document-page-style'
import { paragraphListIndent } from '../../document-page-lists'

export type ArrowNeighbor = {
  id: string
  text: string
  lines: WrappedLine[]
  insert?: boolean
}

export type VerticalCaretColumn = {
  column: number | null
  pending: VerticalCaretDelivery | null
}

export type VerticalCaretDelivery = {
  paragraphId: string
  offset: number
}

export function createVerticalCaretColumn(): VerticalCaretColumn {
  return { column: null, pending: null }
}

export function armVerticalDelivery(
  state: VerticalCaretColumn | undefined,
  delivery: VerticalCaretDelivery,
): void {
  if (!state) return
  state.pending = delivery
}

export function isVerticalDelivery(
  state: VerticalCaretColumn | undefined,
  delivery: VerticalCaretDelivery,
): boolean {
  return (
    state?.pending?.paragraphId === delivery.paragraphId &&
    state.pending.offset === delivery.offset
  )
}

export function consumeVerticalDelivery(
  state: VerticalCaretColumn | undefined,
  paragraphId: string,
): boolean {
  if (!state) return false
  const intended = state.pending?.paragraphId === paragraphId
  state.pending = null
  return intended
}

export function visualColumn(lines: WrappedLine[], offset: number): number {
  const line = lines[lineIndex(lines, offset)]
  return line ? Math.max(0, offset - line.from) : offset
}

export function retainVerticalColumn(
  state: VerticalCaretColumn | undefined,
  lines: WrappedLine[],
  offset: number,
): number {
  if (!state) return visualColumn(lines, offset)
  state.column ??= visualColumn(lines, offset)
  return state.column
}

export function clearVerticalColumn(
  state: VerticalCaretColumn | undefined,
): void {
  if (!state) return
  state.column = null
  state.pending = null
}

export function offsetVertically(input: {
  key: 'ArrowUp' | 'ArrowDown'
  offset: number
  lines: WrappedLine[]
  column: number
}): number | undefined {
  const index = lineIndex(input.lines, input.offset)
  const line = input.lines[input.key === 'ArrowUp' ? index - 1 : index + 1]
  return line ? offsetOnLine(line, input.column) : undefined
}

export function offsetAfterArrow(input: {
  key: string
  offset: number
  text: string
  lines: WrappedLine[]
  column: number
  previous?: ArrowNeighbor
  next?: ArrowNeighbor
}): { paragraphId: string; offset: number } | undefined {
  const { key, offset, text, lines, column, previous, next } = input
  const index = lineIndex(lines, offset)
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
    const next = lines[index + 1]
    if (offset < line.to) return index
    if (offset === line.to && (!next || next.from > line.to)) return index
  }
  return Math.max(0, lines.length - 1)
}

function offsetOnLine(line: WrappedLine | undefined, column: number): number {
  if (!line) return column
  const candidate = Math.min(line.from + column, line.to)
  const local = candidate - line.from
  if (local < line.text.length && isLowSurrogate(line.text.charCodeAt(local))) {
    return Math.max(0, candidate - 1)
  }
  if (
    candidate === line.to &&
    isHighSurrogate(line.text.charCodeAt(line.text.length - 1))
  ) {
    return candidate - 1
  }
  return candidate
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

export type ParagraphNeighborResolver = (
  paragraphId: string,
  wrapWidthPx?: number,
  drafts?: Record<string, string>,
) => { previous?: ArrowNeighbor; next?: ArrowNeighbor }

type NeighborSource = {
  model: DocumentModelWire
  drafts?: Record<string, string>
  extraRuns?: ExtraRuns
  inserts: LocalInsert[]
  paragraphs: DocumentParagraphWire[]
  order?: string[]
}

export function paragraphNeighborResolver(
  ctx: NeighborSource & { deletedParagraphIds: string[] },
): ParagraphNeighborResolver {
  const readOnly = new Set(
    ctx.paragraphs
      .filter((paragraph) => revisionOnlyParagraph(ctx.model, paragraph))
      .map((paragraph) => paragraph.id),
  )
  const order = (
    ctx.order ??
    flowParagraphIds(ctx.model, ctx.inserts, ctx.deletedParagraphIds)
  ).filter((id) => !readOnly.has(id))
  const index = new Map(order.map((id, at) => [id, at]))
  return (paragraphId, wrapWidthPx, drafts) => {
    const at = index.get(paragraphId)
    if (at === undefined) return {}
    const live = drafts ? { ...ctx, drafts } : ctx
    return {
      previous: arrowNeighbor(order[at - 1], live, wrapWidthPx),
      next: arrowNeighbor(order[at + 1], live, wrapWidthPx),
    }
  }
}

function arrowNeighbor(
  id: string | undefined,
  ctx: NeighborSource,
  wrapWidthPx?: number,
): ArrowNeighbor | undefined {
  if (!id) return undefined
  const insert = ctx.inserts.find((item) => item.clientId === id)
  const stored = ctx.paragraphs.find((item) => item.id === id)
  const paragraph = stored
    ? effectiveParagraph(stored, ctx.drafts, ctx.extraRuns?.[stored.id] ?? [])
    : undefined
  const text = insert
    ? insertPlainText(insert)
    : paragraph
      ? paragraphPlainText(paragraph)
      : ''
  const face = paragraph
    ? paragraphFace(paragraph, ctx.model.styles)
    : undefined
  const fontSizePx = face?.run.fontSizePx ?? 16
  const list = paragraph ? paragraphListIndent(paragraph, ctx.model) : undefined
  const firstLinePx = face ? firstLineIndentPx(face, Boolean(list)) : 0
  const lines = wrapLines(
    text,
    fontSizePx,
    wrapWidthPx && wrapWidthPx > 0 ? wrapWidthPx : Number.POSITIVE_INFINITY,
    face?.run.fontFamily,
    firstLinePx,
  )
  return { id, text, lines, ...(insert ? { insert: true } : {}) }
}
