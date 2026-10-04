import type { ListKind } from '../../document-list-toggle'
import type {
  HighlightValue,
  VertAlignValue,
} from '../../document-format-types'

export type DocumentFormatToolbar = {
  paragraphStyleId: string
  paragraphStyles: ReadonlyArray<{ styleId: string; name: string }>
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
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
  emphasisUnavailable?: string
  onToggleBold: () => void
  onToggleItalic: () => void
  onToggleUnderline: () => void
  onToggleStrikethrough: () => void
  onToggleHighlight: () => void
  onToggleSuperscript: () => void
  onToggleSubscript: () => void
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
