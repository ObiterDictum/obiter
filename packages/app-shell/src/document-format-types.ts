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
  startOverride?: number | null
}

type ParagraphIndentationDraft = {
  left?: number | null
  right?: number | null
  firstLine?: number | null
  hanging?: number | null
}

export type ParagraphFormatDraft = Partial<{
  alignment: AlignmentValue | null
  lineSpacing: { line: number; lineRule?: LineRuleValue } | null
  indentation: ParagraphIndentationDraft | null
}>

type SectionMarginDraft = Partial<{
  top: number | null
  right: number | null
  bottom: number | null
  left: number | null
  header: number | null
  footer: number | null
  gutter: number | null
}>

export type SectionDraft = Partial<{
  margins: SectionMarginDraft | null
  orientation: 'portrait' | 'landscape' | null
  pageSize: { width: number; height: number } | null
}>

export type FormatDrafts = {
  emphasis: PendingEmphasis[]
  paragraphStyles: Record<string, string | null>
  numbering: Record<string, NumberingDraft>
  paragraphFormats: Record<string, ParagraphFormatDraft>
  section: SectionDraft
}

export const emptyFormatDrafts: FormatDrafts = {
  emphasis: [],
  paragraphStyles: {},
  numbering: {},
  paragraphFormats: {},
  section: {},
}
