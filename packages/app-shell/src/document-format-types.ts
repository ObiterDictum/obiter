import {
  documentEditHighlightSchema,
  documentEditVertAlignSchema,
} from '@obiter/contracts'

export type HighlightValue =
  (typeof documentEditHighlightSchema.options)[number]
export type VertAlignValue =
  (typeof documentEditVertAlignSchema.options)[number]

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

export type FormatDrafts = {
  emphasis: PendingEmphasis[]
  paragraphStyles: Record<string, string | null>
  numbering: Record<string, NumberingDraft>
}

export const emptyFormatDrafts: FormatDrafts = {
  emphasis: [],
  paragraphStyles: {},
  numbering: {},
}
