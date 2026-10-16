import type { ReactNode } from 'react'
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

export type DocumentFormatToolbar = {
  paragraphStyleId: string
  /** True when the target paragraphs do not all carry one style. */
  paragraphStyleMixed: boolean
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
  canRestart: boolean
  /** True when every numbered target carries a start override. */
  listRestarted: boolean
  listKind: ListKind | null
  canApplyBullet: boolean
  canApplyNumber: boolean
  canApplyMultilevel: boolean
  /** The page-margin preset every target agrees on, or '' when custom/mixed. */
  marginsKind: SectionMarginsKind
  orientation: 'portrait' | 'landscape'
  /** The page-size preset the section matches, or '' when custom. */
  pageSizeKind: PageSizeKind
  /** Set when tracked changes are on: page setup is not recorded as tracked. */
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

/**
 * The Insert ribbon's structural controls: a table after the caret's
 * paragraph and a picture at the caret. A disabled control carries the reason
 * its accessible name publishes, matching the other ribbons' availability
 * messaging.
 */
export type DocumentStructureToolbar = {
  /** The reason a table cannot be inserted at the caret, when it cannot. */
  tableUnavailable?: string
  /** The reason a picture cannot be inserted at the caret, when it cannot. */
  pictureUnavailable?: string
  /** The reason no selection can take a hyperlink, when it cannot. */
  linkUnavailable?: string
  /** The reason no cross-reference can be inserted, when it cannot. */
  crossReferenceUnavailable?: string
  /** The reason no page number can be inserted at the caret, when it cannot. */
  pageNumberUnavailable?: string
  /** The reason no footnote can be inserted at the caret, when it cannot. */
  footnoteUnavailable?: string
  /** The paragraphs a cross-reference can point at, in story order. */
  crossReferenceTargets: ReadonlyArray<{ id: string; label: string }>
  /** The non-body story open for editing, when one is — pressed state for
   * the Header and Footer buttons. */
  editingStoryKind?: 'header' | 'footer' | 'footnotes'
  /** The reason the header cannot be opened for editing, when it cannot. */
  headerUnavailable?: string
  /** The reason the footer cannot be opened for editing, when it cannot. */
  footerUnavailable?: string
  /** Opens the final section's header or footer — or the footnotes story —
   * for editing; the body is inert until the story closes. A named paragraph
   * lands the caret there instead of the story's first. */
  onOpenStory: (
    kind: 'header' | 'footer' | 'footnotes',
    selectId?: string,
  ) => void
  /** Returns the caret to the body, closing the open margin story. */
  onCloseStory: () => void
  onInsertTable: (rows: number, columns: number) => void
  /** Applies a pending hyperlink to the current selection's range. */
  onInsertLink: (target: string) => StructuralInsertOutcome
  /** Holds a pending cross-reference at the caret to the target paragraph. */
  onInsertCrossReference: (targetParagraphId: string) => StructuralInsertOutcome
  /** Holds a pending `PAGE` field at the caret in the active story. */
  onInsertPageNumber: () => void
  /**
   * Holds a pending footnote reference at the body caret and opens the
   * footnotes story so the note's text is typed into its folded body.
   */
  onInsertFootnote: () => void
  /** Opens the picture file picker; the picked file becomes the insertion. */
  onInsertPicture: () => void
  /**
   * The hidden file input the Picture button forwards clicks to. Mounted by
   * the ribbon so the picked file becomes the insertion.
   */
  picturePicker?: ReactNode
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
