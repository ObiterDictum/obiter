export type PendingEmphasis = {
  runId?: string
  paragraphId?: string
  from?: number
  to?: number
  bold?: boolean | null
  italic?: boolean | null
  underline?: boolean | null
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
