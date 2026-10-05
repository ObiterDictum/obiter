import {
  documentEditAlignmentSchema,
  documentEditHighlightSchema,
  documentEditLineRuleSchema,
  documentEditVertAlignSchema,
} from '@obiter/contracts'

export type HighlightValue =
  (typeof documentEditHighlightSchema.options)[number]
export type VertAlignValue =
  (typeof documentEditVertAlignSchema.options)[number]
export type AlignmentValue =
  (typeof documentEditAlignmentSchema.options)[number]
export type LineRuleValue = (typeof documentEditLineRuleSchema.options)[number]

/**
 * The run character properties the Home ribbon can set on a selection. It
 * mirrors the contract's `set_run_emphasis` fields exactly so paint and save
 * cannot disagree about a property: every field here is written by the paint
 * layer, the save operation and the exported DOCX from one description.
 *
 * A `null` releases the direct property so the run inherits its style again;
 * that is how Clear formatting removes every property at once.
 */
export type EmphasisPatch = Partial<{
  bold: boolean | null
  italic: boolean | null
  underline: boolean | null
  strikethrough: boolean | null
  fontFamily: string | null
  fontSize: number | null
  colour: string | null
  highlight: HighlightValue | null
  vertAlign: VertAlignValue | null
  smallCaps: boolean | null
}>

export type PendingEmphasis = EmphasisPatch & {
  runId?: string
  paragraphId?: string
  from?: number
  to?: number
}

export type NumberingDraft = {
  numId: string | null
  ilvl?: number
}

export type ParagraphIndentationDraft = {
  left?: number | null
  right?: number | null
  firstLine?: number | null
  hanging?: number | null
}

/**
 * The paragraph layout the Home and Layout ribbons can set on the paragraphs a
 * target covers. It mirrors the contract's `set_paragraph_format` fields so the
 * paint layer, the save operation and the exported DOCX read one description.
 *
 * Omitted/`undefined` leaves the current direct value alone; `null` releases it
 * so the paragraph style governs again. Space before/after are deliberately not
 * here: no control writes them, so carrying them would be dead paint and save.
 */
export type ParagraphFormatDraft = Partial<{
  alignment: AlignmentValue | null
  lineSpacing: { line: number; lineRule?: LineRuleValue } | null
  indentation: ParagraphIndentationDraft | null
}>

export type FormatDrafts = {
  emphasis: PendingEmphasis[]
  paragraphStyles: Record<string, string | null>
  numbering: Record<string, NumberingDraft>
  paragraphFormats: Record<string, ParagraphFormatDraft>
}

export const emptyFormatDrafts: FormatDrafts = {
  emphasis: [],
  paragraphStyles: {},
  numbering: {},
  paragraphFormats: {},
}
