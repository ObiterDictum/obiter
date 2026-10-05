import type { ListKind } from '../../document-list-toggle'
import type { IndentKind } from '../../document-paragraph-format'
import type {
  AlignmentValue,
  HighlightValue,
  VertAlignValue,
} from '../../document-format-types'

export type DocumentFormatToolbar = {
  paragraphStyleId: string
  paragraphStyles: ReadonlyArray<{ styleId: string; name: string }>
  /** The alignment every target paragraph agrees on, or null when mixed. */
  alignment: AlignmentValue | null
  /** A line-spacing option value, or '' when mixed or not an option. */
  lineSpacing: string
  /** The indent kind every target agrees on, or null when mixed. */
  indentKind: IndentKind | null
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
  /** The direct font family the covered runs agree on, or null when unset. */
  fontFamily: string | null
  /** The direct size in half-points, the contract's unit, or null when unset. */
  fontSize: number | null
  /** The direct colour as `auto` or six hex digits, or null when unset. */
  colour: string | null
  highlight: HighlightValue | null
  vertAlign: VertAlignValue | null
  canIndent: boolean
  canOutdent: boolean
  canContinue: boolean
  listKind: ListKind | null
  canApplyBullet: boolean
  canApplyNumber: boolean
  canApplyMultilevel: boolean
  onParagraphStyle: (styleId: string | null) => void
  onAlignment: (alignment: AlignmentValue) => void
  onLineSpacing: (value: string) => void
  onIndentKind: (kind: IndentKind) => void
  emphasisUnavailable?: string
  onToggleBold: () => void
  onToggleItalic: () => void
  onToggleUnderline: () => void
  onToggleStrikethrough: () => void
  onToggleHighlight: () => void
  onToggleSuperscript: () => void
  onToggleSubscript: () => void
  onFontFamily: (fontFamily: string | null) => void
  onFontSize: (fontSize: number | null) => void
  onColour: (colour: string | null) => void
  onClearFormatting: () => void
  onIndent: () => void
  onOutdent: () => void
  onContinueList: () => void
  onToggleList: (kind: ListKind) => void
}

/**
 * The clipboard controls' availability and handlers. Copy and cut need a live
 * document selection; paste needs an editable document. A disabled control
 * carries the reason its accessible name publishes, so the state is announced
 * rather than only implied by a greyed button.
 */
export type DocumentClipboardToolbar = {
  canCopy: boolean
  canCut: boolean
  canPaste: boolean
  copyReason?: string
  cutReason?: string
  pasteReason?: string
  onCopy: () => void
  onCut: () => void
  onPaste: () => void
}

export type DocumentFindToolbar = {
  query: string
  replace: string
  matchLabel: string
  canReplace: boolean
  onQuery: (query: string) => void
  onReplace: (value: string) => void
  onNext: () => void
  onPrevious: () => void
  onReplaceOne: () => void
  onReplaceAll: () => void
}
