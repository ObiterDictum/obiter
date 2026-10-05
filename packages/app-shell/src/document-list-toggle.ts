import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import type { FormatDrafts, NumberingDraft } from './document-format-edits'
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

export function pickNumberingId(
  model: DocumentModelWire,
  kind: ListKind,
): string | undefined {
  return model.numbering.find((item) => numberingKind(item.levels) === kind)
    ?.numberingId
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
  const instance = model.numbering.find(
    (item) => item.numberingId === current.numId,
  )
  return numberingKind(instance?.levels)
}

export function toggleParagraphList(
  format: FormatDrafts,
  model: DocumentModelWire,
  paragraph: DocumentParagraphWire,
  kind: ListKind,
): FormatDrafts {
  const numId = pickNumberingId(model, kind)
  if (!numId) return format
  const currentKind = paragraphListKind(model, format, paragraph)
  const next: NumberingDraft =
    currentKind === kind ? { numId: null } : { numId, ilvl: 0 }
  return {
    ...format,
    numbering: { ...format.numbering, [paragraph.id]: next },
  }
}
