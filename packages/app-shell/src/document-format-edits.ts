import type {
  DocumentEditOperation,
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { documentStory } from './document-model-text'
import { paragraphNumPr } from './document-page-lists'
import type { FormatDrafts, PendingEmphasis } from './document-format-types'

export { paragraphNumPr } from './document-page-lists'
export type { ListKind } from './document-list-toggle'
export type {
  FormatDrafts,
  NumberingDraft,
  PendingEmphasis,
} from './document-format-types'
export { emptyFormatDrafts } from './document-format-types'
export {
  formatControlState,
  runFlagOn,
  selectedParagraph,
  selectedParagraphIds,
} from './document-format-controls'
export { formattedModel, paragraphStyleOptions } from './document-format-paint'
export { documentFormatToolbar } from './document-format-toolbar'
export type { FormatTarget, ParagraphRange } from './document-format-toolbar'

export function collectFormatOperations(
  model: DocumentModelWire,
  format: FormatDrafts,
  deletedParagraphIds: readonly string[],
  /**
   * Addresses that must not become their own operation because they belong to
   * something else in the same batch; a pending insert's style rides on the
   * insert operation. See document-edits collectEditOperations.
   */
  omitParagraphIds: ReadonlySet<string> = new Set(),
): DocumentEditOperation[] {
  const deleted = new Set(deletedParagraphIds)
  const deletedRuns = new Set(
    (documentStory(model)?.paragraphs ?? [])
      .filter((paragraph) => deleted.has(paragraph.id))
      .flatMap((paragraph) => paragraph.runs.map((run) => run.id)),
  )
  const operations: DocumentEditOperation[] = []
  const emphasisByRun = new Map<string, PendingEmphasis>()
  for (const item of format.emphasis) {
    if (item.runId && !deletedRuns.has(item.runId)) {
      emphasisByRun.set(item.runId, item)
    }
  }
  for (const item of emphasisByRun.values()) {
    if (!item.runId) continue
    operations.push({
      type: 'set_run_emphasis',
      runId: item.runId,
      ...(item.bold !== undefined ? { bold: item.bold } : {}),
      ...(item.italic !== undefined ? { italic: item.italic } : {}),
      ...(item.underline !== undefined ? { underline: item.underline } : {}),
    })
  }
  for (const item of format.emphasis) {
    if (
      item.runId ||
      !item.paragraphId ||
      item.from === undefined ||
      item.to === undefined ||
      deleted.has(item.paragraphId)
    ) {
      continue
    }
    operations.push({
      type: 'set_run_emphasis',
      paragraphId: item.paragraphId,
      from: item.from,
      to: item.to,
      ...(item.bold !== undefined ? { bold: item.bold } : {}),
      ...(item.italic !== undefined ? { italic: item.italic } : {}),
      ...(item.underline !== undefined ? { underline: item.underline } : {}),
    })
  }
  for (const [paragraphId, styleId] of Object.entries(format.paragraphStyles)) {
    if (deleted.has(paragraphId) || omitParagraphIds.has(paragraphId)) continue
    operations.push({
      type: 'set_paragraph_style',
      paragraphId,
      styleId,
    })
  }
  for (const [paragraphId, numbering] of Object.entries(format.numbering)) {
    if (deleted.has(paragraphId) || omitParagraphIds.has(paragraphId)) continue
    operations.push({
      type: 'set_paragraph_numbering',
      paragraphId,
      numId: numbering.numId,
      ...(numbering.ilvl !== undefined ? { ilvl: numbering.ilvl } : {}),
    })
  }
  return operations
}
export function mergeEmphasis(
  current: PendingEmphasis[],
  next: PendingEmphasis,
): PendingEmphasis[] {
  if (next.paragraphId !== undefined) return [...current, next]
  const previous = current.find((item) => item.runId === next.runId)
  return [
    ...current.filter((item) => item.runId !== next.runId),
    { ...previous, ...next },
  ]
}

export function emphasisAddress(
  paragraph: DocumentParagraphWire,
  sliceFrom: number,
  selectionStart: number,
  selectionEnd: number,
): { runId: string } | { paragraphId: string; from: number; to: number } {
  const from = sliceFrom + Math.min(selectionStart, selectionEnd)
  const to = sliceFrom + Math.max(selectionStart, selectionEnd)
  if (from !== to) return { paragraphId: paragraph.id, from, to }
  let cursor = 0
  for (const run of paragraph.runs) {
    const end = cursor + run.text.length
    if (from >= cursor && from < end) return { runId: run.id }
    cursor = end
  }
  const last = paragraph.runs[paragraph.runs.length - 1]
  return { runId: last?.id ?? '' }
}
export function toggleEmphasisOnRuns(
  format: FormatDrafts,
  runIds: readonly string[],
  flag: 'bold' | 'italic' | 'underline',
  value: boolean,
): FormatDrafts {
  let emphasis = format.emphasis
  for (const runId of runIds) {
    emphasis = mergeEmphasis(emphasis, { runId, [flag]: value })
  }
  return { ...format, emphasis }
}

export function toggleEmphasisAtAddress(
  format: FormatDrafts,
  address: ReturnType<typeof emphasisAddress>,
  flag: 'bold' | 'italic' | 'underline',
  value: boolean,
): FormatDrafts {
  if ('runId' in address) {
    if (!address.runId) return format
    return toggleEmphasisOnRuns(format, [address.runId], flag, value)
  }
  return {
    ...format,
    emphasis: mergeEmphasis(format.emphasis, {
      paragraphId: address.paragraphId,
      from: address.from,
      to: address.to,
      [flag]: value,
    }),
  }
}

export function setParagraphStyleDraft(
  format: FormatDrafts,
  paragraphId: string,
  styleId: string | null,
): FormatDrafts {
  return {
    ...format,
    paragraphStyles: { ...format.paragraphStyles, [paragraphId]: styleId },
  }
}

export function indentList(
  format: FormatDrafts,
  model: DocumentModelWire,
  paragraph: DocumentParagraphWire,
): FormatDrafts {
  const current =
    format.numbering[paragraph.id] ?? paragraphNumPr(paragraph, model.styles)
  if (!current?.numId) return format
  const ilvl = Math.min(8, (current.ilvl ?? 0) + 1)
  const instance = model.numbering.find(
    (item) => item.numberingId === current.numId,
  )
  if (!instance?.levels?.some((level) => level.ilvl === ilvl)) return format
  return {
    ...format,
    numbering: {
      ...format.numbering,
      [paragraph.id]: { numId: current.numId, ilvl },
    },
  }
}

export function outdentList(
  format: FormatDrafts,
  model: DocumentModelWire,
  paragraph: DocumentParagraphWire,
): FormatDrafts {
  const current =
    format.numbering[paragraph.id] ?? paragraphNumPr(paragraph, model.styles)
  if (!current?.numId) return format
  const ilvl = current.ilvl ?? 0
  return {
    ...format,
    numbering: {
      ...format.numbering,
      [paragraph.id]:
        ilvl <= 0 ? { numId: null } : { numId: current.numId, ilvl: ilvl - 1 },
    },
  }
}

export function continueList(
  format: FormatDrafts,
  model: DocumentModelWire,
  paragraph: DocumentParagraphWire,
): FormatDrafts {
  const story = documentStory(model)
  if (!story) return format
  const index = story.paragraphs.findIndex((item) => item.id === paragraph.id)
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const previous = story.paragraphs[cursor]
    if (!previous) continue
    const numPr =
      format.numbering[previous.id] ?? paragraphNumPr(previous, model.styles)
    if (!numPr?.numId) continue
    return {
      ...format,
      numbering: { ...format.numbering, [paragraph.id]: numPr },
    }
  }
  return format
}
