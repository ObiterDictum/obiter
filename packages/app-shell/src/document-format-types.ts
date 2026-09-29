import {
  documentEditHighlightSchema,
  documentEditVertAlignSchema,
} from '@obiter/contracts'

export type HighlightValue =
  (typeof documentEditHighlightSchema.options)[number]
export type VertAlignValue =
  (typeof documentEditVertAlignSchema.options)[number]

/**
 * The run character properties the Home ribbon can toggle on a selection. The
 * contract's `set_run_emphasis` carries more (font, size, colour); those have
 * no control yet and stay out of this draft so paint and save cannot disagree
 * about a property nothing writes.
 */
export type EmphasisPatch = Partial<{
  bold: boolean | null
  italic: boolean | null
  underline: boolean | null
  strikethrough: boolean | null
  highlight: HighlightValue | null
  vertAlign: VertAlignValue | null
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
