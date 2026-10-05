import type {
  DocumentModelWire,
  DocumentNumberingWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import type { FormatDrafts } from './document-format-edits'
import { paragraphNumPr } from './document-page-lists'

export type ListKind = 'bullet' | 'number' | 'multilevel'

export function numberingKind(
  levels: ReadonlyArray<{ ilvl: number; numFmt: string }> | undefined,
): ListKind | null {
  if (!levels || levels.length === 0) return null
  if (levels.every((level) => level.numFmt === 'bullet')) return 'bullet'
  const ranked = levels.filter((level) => level.numFmt !== 'bullet')
  if (ranked.length >= 2) return 'multilevel'
  if (ranked.length === 1) return 'number'
  return null
}

export function findNumberingInstance(
  model: Pick<DocumentModelWire, 'numbering'>,
  numberingId: string | null | undefined,
): DocumentNumberingWire | undefined {
  if (!numberingId) return undefined
  return model.numbering.find((item) => item.numberingId === numberingId)
}

/**
 * The numbering instance a list kind is applied from. Several instances can
 * match one kind; the lowest numeric id wins, with a lexical tie-break, so the
 * choice is stable regardless of the order the document declares them in.
 */
export function pickNumberingId(
  model: DocumentModelWire,
  kind: ListKind,
): string | undefined {
  return model.numbering
    .filter((item) => numberingKind(item.levels) === kind)
    .map((item) => item.numberingId)
    .sort(compareNumberingIds)[0]
}

export function paragraphListKind(
  model: DocumentModelWire,
  format: FormatDrafts,
  paragraph: DocumentParagraphWire | undefined,
): ListKind | null {
  if (!paragraph) return null
  const current =
    format.numbering[paragraph.id] ?? paragraphNumPr(paragraph, model.styles)
  if (!current?.numId) return null
  const instance = findNumberingInstance(model, current.numId)
  return numberingKind(instance?.levels)
}

/**
 * The start override the target's list effectively carries: the pending draft
 * wins, otherwise the numbering instance the paragraph points at. `undefined`
 * means the paragraph is not a list or its numbering definition is missing.
 */
export function paragraphStartOverride(
  model: DocumentModelWire,
  format: FormatDrafts,
  paragraph: DocumentParagraphWire | undefined,
): number | null | undefined {
  if (!paragraph) return undefined
  const draft = format.numbering[paragraph.id]
  const numId = draft
    ? draft.numId
    : (paragraphNumPr(paragraph, model.styles)?.numId ?? null)
  if (!numId) return undefined
  if (draft && draft.startOverride !== undefined) return draft.startOverride
  return findNumberingInstance(model, numId)?.startOverride
}

/**
 * One list toggle for a whole target. If every paragraph already carries the
 * kind, the click removes it from all of them; otherwise every target becomes
 * that kind. A mixed selection therefore never both adds and removes in one
 * click, which per-paragraph toggling would do.
 */
export function toggleParagraphListOnTargets(
  format: FormatDrafts,
  model: DocumentModelWire,
  paragraphs: readonly DocumentParagraphWire[],
  kind: ListKind,
): FormatDrafts {
  const numId = pickNumberingId(model, kind)
  if (!numId || paragraphs.length === 0) return format
  const everyListed = paragraphs.every(
    (paragraph) => paragraphListKind(model, format, paragraph) === kind,
  )
  const numbering = { ...format.numbering }
  for (const paragraph of paragraphs) {
    numbering[paragraph.id] = everyListed ? { numId: null } : { numId, ilvl: 0 }
  }
  return { ...format, numbering }
}

export function toggleParagraphList(
  format: FormatDrafts,
  model: DocumentModelWire,
  paragraph: DocumentParagraphWire,
  kind: ListKind,
): FormatDrafts {
  return toggleParagraphListOnTargets(format, model, [paragraph], kind)
}

function compareNumberingIds(left: string, right: string) {
  const leftNumber = Number(left)
  const rightNumber = Number(right)
  const leftNumeric = Number.isInteger(leftNumber)
  const rightNumeric = Number.isInteger(rightNumber)
  if (leftNumeric && rightNumeric && leftNumber !== rightNumber) {
    return leftNumber - rightNumber
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
  if (left === right) return 0
  return left < right ? -1 : 1
}
