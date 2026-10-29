import type { ReactNode } from 'react'
import type { DocumentMarkingsWire } from '@obiter/contracts'
import type { ListKind } from '../../document-list-toggle'
import type { IndentKind } from '../../document-paragraph-format'
import type {
  PageSizeKind,
  SectionMarginsKind,
} from '../../document-section-format'
import type {
  AlignmentValue,
  HighlightValue,
  VertAlignValue,
} from '../../document-format-types'
import type { StructuralInsertOutcome } from '../../document-structure-toolbar'
import type { FindMatchOptions } from '../../document-find'

export type DocumentFormatToolbar = {
  paragraphStyleId: string
  paragraphStyleMixed: boolean
  paragraphStyles: ReadonlyArray<{ styleId: string; name: string }>
  alignment: AlignmentValue | null
  lineSpacing: string
  indentKind: IndentKind | null
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
  fontFamily: string | null
  fontSize: number | null
  colour: string | null
  highlight: HighlightValue | null
  vertAlign: VertAlignValue | null
  canIndent: boolean
  canOutdent: boolean
  canContinue: boolean
  canRestart: boolean
  listRestarted: boolean
  listKind: ListKind | null
  canApplyBullet: boolean
  canApplyNumber: boolean
  canApplyMultilevel: boolean
  marginsKind: SectionMarginsKind
  orientation: 'portrait' | 'landscape'
  pageSizeKind: PageSizeKind
  layoutUnavailable?: string
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
  onRestartList: () => void
  onToggleList: (kind: ListKind) => void
  onMargins: (kind: SectionMarginsKind) => void
  onOrientation: () => void
  onPageSize: (kind: PageSizeKind) => void
}

export type DocumentMarkingsToolbar = {
  markings: DocumentMarkingsWire
  unavailable?: string
  pending: boolean
  onDocumentKind: (kind: string | null) => void
  onToggleDraft: () => void
  onTogglePrivileged: () => void
  onToggleWithoutPrejudice: () => void
}

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

export type DocumentStructureToolbar = {
  tableUnavailable?: string
  pictureUnavailable?: string
  linkUnavailable?: string
  crossReferenceUnavailable?: string
  definedTermUnavailable?: string
  pageNumberUnavailable?: string
  footnoteUnavailable?: string
  tableOfContentsUnavailable?: string
  tableOfAuthoritiesUnavailable?: string
  tableOfAuthoritiesUpdateUnavailable?: string
  crossReferenceTargets: ReadonlyArray<{ id: string; label: string }>
  editingStoryKind?: 'header' | 'footer' | 'footnotes'
  headerUnavailable?: string
  footerUnavailable?: string
  onOpenStory: (
    kind: 'header' | 'footer' | 'footnotes',
    selectId?: string,
  ) => void
  onCloseStory: () => void
  onInsertTable: (rows: number, columns: number) => void
  onInsertLink: (target: string) => StructuralInsertOutcome
  onInsertCrossReference: (targetParagraphId: string) => StructuralInsertOutcome
  onMarkDefinedTerm: () => void
  onInsertPageNumber: () => void
  onInsertTableOfContents: () => void
  onInsertTableOfAuthorities: () => void
  onUpdateTableOfAuthorities: () => void
  onInsertFootnote: () => void
  onInsertPicture: () => void
  picturePicker?: ReactNode
}

export type DocumentReviewToolbar = {
  unavailable?: string
  bulkUnavailable?: string
  targetUnavailable?: string
  undecidableCount: number
  canPrevious: boolean
  canNext: boolean
  onPreviousChange: () => void
  onNextChange: () => void
  onAcceptChange: () => void
  onRejectChange: () => void
  onAcceptAll: () => void
  onRejectAll: () => void
}

export type DocumentFindToolbar = {
  query: string
  matchLabel: string
  options: FindMatchOptions
  onQuery: (query: string) => void
  onToggleOption: (key: 'matchCase' | 'wholeWord') => void
  onNext: () => void
  onPrevious: () => void
  replace?: string
  canReplace?: boolean
  onReplace?: (value: string) => void
  onReplaceOne?: () => void
  onReplaceAll?: () => void
}

export type LegalChecksFocus = 'terms' | 'references'
