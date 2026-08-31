import type { ListKind } from '../../document-list-toggle'

export type DocumentFormatToolbar = {
  paragraphStyleId: string
  paragraphStyles: ReadonlyArray<{ styleId: string; name: string }>
  bold: boolean
  italic: boolean
  underline: boolean
  canIndent: boolean
  canOutdent: boolean
  canContinue: boolean
  listKind: ListKind | null
  canApplyBullet: boolean
  canApplyNumber: boolean
  canApplyMultilevel: boolean
  onParagraphStyle: (styleId: string | null) => void
  onToggleBold: () => void
  onToggleItalic: () => void
  onToggleUnderline: () => void
  onIndent: () => void
  onOutdent: () => void
  onContinueList: () => void
  onToggleList: (kind: ListKind) => void
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
