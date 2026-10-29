import type { ReactNode } from 'react'

import type { CitationStyle } from '../../document-preferences'
import type { LegalChecksFocus } from './ribbon-types'
import type {
  DocumentClipboardToolbar,
  DocumentFindToolbar,
  DocumentFormatToolbar,
  DocumentMarkingsToolbar,
  DocumentReviewToolbar,
  DocumentStructureToolbar,
} from './ribbon-types'
import type { InsertRibbonProps } from './use-insert-ribbon'
import { revealDocumentRedactionRuns } from './document-actions'

type EditorMenuId = 'file' | 'edit' | 'insert' | 'format' | 'review' | 'view'

/** One row a menu, the command palette and the toolbar can each offer. */
export type EditorCommand = {
  id: string
  label: string
  icon?: ReactNode
  shortcut?: string
  hint?: string
  pressed?: boolean
  /** Set on a radio choice: the row is one of a mutually exclusive set. */
  checked?: boolean
  disabled?: boolean
  disabledReason?: string
  soon?: boolean | string
  /** A state the user flips repeatedly keeps the menu open. */
  stayOpen?: boolean
  /** The command opens a surface that takes focus of its own (dialog, panel). */
  opensSurface?: boolean
  run?: () => void
}

export type EditorMenu = {
  id: EditorMenuId
  label: string
  groups: ReadonlyArray<{ label: string; commands: EditorCommand[] }>
}

/** Everything the chrome needs; it is the old ribbon's prop set, unchanged. */
export type EditorChromeProps = InsertRibbonProps & {
  canEdit: boolean
  trackChanges: boolean
  zoom: number
  commentsOpen: boolean
  changesOpen: boolean
  authoritiesOpen: boolean
  infoOpen: boolean
  commentCount: number
  changeCount: number
  canUndo?: boolean
  canRedo?: boolean
  onToggleComments: () => void
  onToggleChanges: () => void
  onToggleAuthorities: () => void
  onToggleInfo?: () => void
  onInsertAuthority: () => void
  citationStyle: CitationStyle
  onCitationStyle?: (style: CitationStyle) => void
  legalChecks?: {
    open: LegalChecksFocus | null
    onOpen: (focus: LegalChecksFocus) => void
  }
  onOpenVerify?: () => void
  onToggleTrackChanges: () => void
  onZoom: (next: number) => void
  onExportText: () => void
  onExportShareSafe: () => void
  onPrint: () => void
  onUndo: () => void
  onRedo: () => void
  onInsertParagraph: () => void
  onDeleteParagraph: () => void
  deleteParagraphReason?: string
  format?: DocumentFormatToolbar
  clipboard?: DocumentClipboardToolbar
  find?: DocumentFindToolbar
  review?: DocumentReviewToolbar
  markings?: DocumentMarkingsToolbar
  view: 'print' | 'web'
  onView: (view: 'print' | 'web') => void
  rulerOn: boolean
  onToggleRuler: () => void
  navOpen: boolean
  onToggleNavPane: () => void
  spelling: boolean
  onToggleSpelling: () => void
  /** Opens the version comparison surface; absent without two versions. */
  onOpenCompare?: () => void
  /** The one availability answer for starting a verification run. */
  verify?: { available: boolean; reason: string; pending: boolean }
  onSave: () => void
  canSave: boolean
  saveReason?: string
}

/** The chrome's own surfaces, which are not commands but hold them. */
export type EditorChromeActions = {
  openFormatting: () => void
  openFind: () => void
  openPalette: () => void
  openTable: () => void
  openLink: () => void
  openCrossReference: () => void
  closeStory: () => void
}

const EDITING_HINT = 'Requires an editable document.'

export function editorMenus(
  props: EditorChromeProps,
  actions: EditorChromeActions,
): EditorMenu[] {
  const { format, clipboard, review, structure, find } = props
  const editing = props.canEdit && Boolean(format)
  const reviewAbsent = 'Change review is not available for this document.'
  const story = structure?.editingStoryKind
  const citationStyles: Array<{ value: CitationStyle; label: string }> = [
    { value: 'oscola', label: 'OSCOLA' },
    { value: 'house', label: 'House style' },
  ]
  const menus: EditorMenu[] = [
    {
      id: 'file',
      label: 'File',
      groups: [
        {
          label: 'Document',
          commands: [
            {
              id: 'save',
              label: 'Save',
              shortcut: 'Ctrl S',
              disabled: !props.canSave,
              disabledReason: props.saveReason,
              run: props.onSave,
            },
            {
              id: 'info',
              label: 'Document information',
              pressed: props.infoOpen,
              disabled: props.onToggleInfo === undefined,
              disabledReason: 'The document detail is not loaded.',
              stayOpen: true,
              run: props.onToggleInfo,
            },
            {
              id: 'export',
              label: 'Export',
              run: props.onExportText,
            },
            {
              id: 'export-share-safe',
              label: 'Share-safe export',
              hint: 'Removes metadata and comments, and unlinks external hyperlinks',
              run: props.onExportShareSafe,
            },
            {
              id: 'print',
              label: 'Print',
              shortcut: 'Ctrl P',
              run: props.onPrint,
            },
          ],
        },
        {
          label: 'Versions',
          commands: [
            {
              id: 'compare',
              label: 'Compare versions',
              opensSurface: true,
              disabled: props.onOpenCompare === undefined,
              disabledReason: 'Two stored versions are needed to compare.',
              run: props.onOpenCompare,
            },
          ],
        },
        {
          label: 'Redaction',
          commands: [
            {
              id: 'redact',
              label: 'Redact this document',
              run: revealDocumentRedactionRuns,
            },
          ],
        },
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      groups: [
        {
          label: 'History',
          commands: [
            {
              id: 'undo',
              label: 'Undo',
              shortcut: 'Ctrl Z',
              disabled: !props.canEdit || !props.canUndo,
              run: props.onUndo,
            },
            {
              id: 'redo',
              label: 'Redo',
              shortcut: 'Ctrl Shift Z',
              disabled: !props.canEdit || !props.canRedo,
              run: props.onRedo,
            },
          ],
        },
        {
          label: 'Clipboard',
          commands: [
            {
              id: 'cut',
              label: 'Cut',
              shortcut: 'Ctrl X',
              disabled: !clipboard?.canCut,
              disabledReason: clipboard?.cutReason,
              run: clipboard?.onCut,
            },
            {
              id: 'copy',
              label: 'Copy',
              shortcut: 'Ctrl C',
              disabled: !clipboard?.canCopy,
              disabledReason: clipboard?.copyReason,
              run: clipboard?.onCopy,
            },
            {
              id: 'paste',
              label: 'Paste',
              shortcut: 'Ctrl V',
              disabled: !clipboard?.canPaste,
              disabledReason: clipboard?.pasteReason,
              run: clipboard?.onPaste,
            },
          ],
        },
        {
          label: 'Paragraph',
          commands: [
            {
              id: 'insert-paragraph',
              label: 'Insert paragraph',
              disabled: !props.canEdit,
              run: props.onInsertParagraph,
            },
            {
              id: 'delete-paragraph',
              label: 'Delete paragraph',
              disabled:
                !props.canEdit || props.deleteParagraphReason !== undefined,
              disabledReason: props.deleteParagraphReason,
              run: props.onDeleteParagraph,
            },
          ],
        },
        {
          label: 'Find',
          commands: [
            {
              id: 'find',
              label: 'Find and replace',
              shortcut: 'Ctrl F',
              hint: find ? undefined : EDITING_HINT,
              disabled: !find,
              opensSurface: true,
              run: actions.openFind,
            },
            {
              id: 'commands',
              label: 'All commands',
              shortcut: 'Ctrl K',
              opensSurface: true,
              run: actions.openPalette,
            },
          ],
        },
      ],
    },
    {
      id: 'insert',
      label: 'Insert',
      groups: [
        {
          label: 'Breaks',
          commands: [
            {
              id: 'page-break',
              stayOpen: true,
              label: 'Page break',
              disabled: Boolean(props.breakUnavailable),
              disabledReason: props.breakUnavailable,
              run: props.onPageBreak,
            },
            {
              id: 'section-break',
              stayOpen: true,
              label: 'Section break',
              disabled: Boolean(props.breakUnavailable),
              disabledReason: props.breakUnavailable,
              run: props.onSectionBreak,
            },
          ],
        },
        {
          label: 'Tables and pictures',
          commands: [
            {
              id: 'table',
              label: 'Insert table',
              opensSurface: true,
              disabled: !structure || Boolean(structure.tableUnavailable),
              disabledReason: structure?.tableUnavailable,
              run: actions.openTable,
            },
            {
              id: 'picture',
              stayOpen: true,
              label: 'Picture',
              disabled: !structure || Boolean(structure.pictureUnavailable),
              disabledReason: structure?.pictureUnavailable,
              run: structure?.onInsertPicture,
            },
          ],
        },
        {
          label: 'Links',
          commands: [
            {
              id: 'link',
              label: 'Link',
              opensSurface: true,
              disabled: !structure || Boolean(structure.linkUnavailable),
              disabledReason: structure?.linkUnavailable,
              run: actions.openLink,
            },
            {
              id: 'cross-reference',
              label: 'Cross-reference',
              opensSurface: true,
              disabled:
                !structure || Boolean(structure.crossReferenceUnavailable),
              disabledReason: structure?.crossReferenceUnavailable,
              run: actions.openCrossReference,
            },
          ],
        },
        {
          label: 'Notes',
          commands: [
            {
              id: 'footnote',
              stayOpen: true,
              label: story === 'footnotes' ? 'Close footnotes' : 'Footnote',
              pressed: story === 'footnotes',
              disabled:
                !structure ||
                (story !== 'footnotes' &&
                  Boolean(structure.footnoteUnavailable)),
              disabledReason: structure?.footnoteUnavailable,
              run: () => {
                if (story === 'footnotes') actions.closeStory()
                else structure?.onInsertFootnote()
              },
            },
            {
              id: 'table-of-contents',
              stayOpen: true,
              label: 'Table of contents',
              disabled:
                !structure || Boolean(structure.tableOfContentsUnavailable),
              disabledReason: structure?.tableOfContentsUnavailable,
              run: structure?.onInsertTableOfContents,
            },
          ],
        },
        {
          label: 'Header and footer',
          commands: [
            {
              id: 'header',
              stayOpen: true,
              label: story === 'header' ? 'Close header' : 'Header',
              pressed: story === 'header',
              disabled:
                !structure ||
                (story !== 'header' && Boolean(structure.headerUnavailable)),
              disabledReason: structure?.headerUnavailable,
              run: () => {
                if (story === 'header') actions.closeStory()
                else structure?.onOpenStory('header')
              },
            },
            {
              id: 'footer',
              stayOpen: true,
              label: story === 'footer' ? 'Close footer' : 'Footer',
              pressed: story === 'footer',
              disabled:
                !structure ||
                (story !== 'footer' && Boolean(structure.footerUnavailable)),
              disabledReason: structure?.footerUnavailable,
              run: () => {
                if (story === 'footer') actions.closeStory()
                else structure?.onOpenStory('footer')
              },
            },
            {
              id: 'page-number',
              stayOpen: true,
              label: 'Page number',
              disabled: !structure || Boolean(structure.pageNumberUnavailable),
              disabledReason: structure?.pageNumberUnavailable,
              run: structure?.onInsertPageNumber,
            },
          ],
        },
        {
          label: 'Authorities',
          commands: [
            {
              id: 'insert-authority',
              stayOpen: true,
              opensSurface: true,
              label: 'Insert authority',
              run: props.onInsertAuthority,
            },
            {
              id: 'table-of-authorities',
              label: 'Table of authorities',
              disabled:
                !structure || Boolean(structure.tableOfAuthoritiesUnavailable),
              disabledReason: structure?.tableOfAuthoritiesUnavailable,
              run: structure?.onInsertTableOfAuthorities,
            },
            {
              id: 'update-authorities',
              label: 'Update table of authorities',
              disabled:
                !structure ||
                Boolean(structure.tableOfAuthoritiesUpdateUnavailable),
              disabledReason: structure?.tableOfAuthoritiesUpdateUnavailable,
              run: structure?.onUpdateTableOfAuthorities,
            },
            {
              id: 'mark-defined-term',
              label: 'Mark defined term',
              disabled: !structure || Boolean(structure.definedTermUnavailable),
              disabledReason: structure?.definedTermUnavailable,
              run: structure?.onMarkDefinedTerm,
            },
            ...citationStyles.map((style) => ({
              id: `citation-style-${style.value}`,
              label: `Citation style: ${style.label}`,
              checked:
                props.onCitationStyle !== undefined
                  ? props.citationStyle === style.value
                  : undefined,
              disabled: props.onCitationStyle === undefined,
              disabledReason: 'Citation style is not available here.',
              stayOpen: true,
              run: () => props.onCitationStyle?.(style.value),
            })),
          ],
        },
      ],
    },
    {
      id: 'format',
      label: 'Format',
      groups: [
        {
          label: 'Formatting',
          commands: [
            {
              id: 'formatting-panel',
              label: 'Font, paragraph and page settings',
              opensSurface: true,
              disabled: !editing,
              disabledReason: EDITING_HINT,
              run: actions.openFormatting,
            },
          ],
        },
        {
          label: 'Styles',
          commands: (format?.paragraphStyles ?? []).map((style) => ({
            id: `style-${style.styleId}`,
            label: styleDisplayName(style.name, style.styleId),
            checked: !format?.paragraphStyleMixed
              ? format?.paragraphStyleId === style.styleId
              : false,
            disabled: !editing,
            disabledReason: EDITING_HINT,
            stayOpen: true,
            run: () => format?.onParagraphStyle(style.styleId),
          })),
        },
        {
          label: 'Character',
          commands: [
            {
              id: 'bold',
              label: 'Bold',
              shortcut: 'Ctrl B',
              pressed: Boolean(format?.bold),
              disabled: !editing || Boolean(format?.emphasisUnavailable),
              disabledReason: format?.emphasisUnavailable,
              stayOpen: true,
              run: format?.onToggleBold,
            },
            {
              id: 'italic',
              label: 'Italic',
              shortcut: 'Ctrl I',
              pressed: Boolean(format?.italic),
              disabled: !editing,
              disabledReason: format?.emphasisUnavailable,
              stayOpen: true,
              run: format?.onToggleItalic,
            },
            {
              id: 'underline',
              label: 'Underline',
              shortcut: 'Ctrl U',
              pressed: Boolean(format?.underline),
              disabled: !editing,
              disabledReason: format?.emphasisUnavailable,
              stayOpen: true,
              run: format?.onToggleUnderline,
            },
            {
              id: 'strikethrough',
              label: 'Strikethrough',
              pressed: Boolean(format?.strikethrough),
              disabled: !editing,
              disabledReason: format?.emphasisUnavailable,
              stayOpen: true,
              run: format?.onToggleStrikethrough,
            },
            {
              id: 'highlight',
              label: 'Highlight',
              pressed: Boolean(
                format?.highlight && format.highlight !== 'none',
              ),
              disabled: !editing,
              disabledReason: format?.emphasisUnavailable,
              stayOpen: true,
              run: format?.onToggleHighlight,
            },
            {
              id: 'superscript',
              label: 'Superscript',
              pressed: format?.vertAlign === 'superscript',
              disabled: !editing,
              disabledReason: format?.emphasisUnavailable,
              stayOpen: true,
              run: format?.onToggleSuperscript,
            },
            {
              id: 'subscript',
              label: 'Subscript',
              pressed: format?.vertAlign === 'subscript',
              disabled: !editing,
              disabledReason: format?.emphasisUnavailable,
              stayOpen: true,
              run: format?.onToggleSubscript,
            },
            {
              id: 'clear-formatting',
              label: 'Clear formatting',
              disabled: !editing,
              disabledReason: format?.emphasisUnavailable,
              run: format?.onClearFormatting,
            },
          ],
        },
        {
          label: 'Lists',
          commands: [
            {
              id: 'bullets',
              label: 'Bullets',
              pressed: format?.listKind === 'bullet',
              disabled: !editing || !format?.canApplyBullet,
              stayOpen: true,
              run: () => format?.onToggleList('bullet'),
            },
            {
              id: 'numbering',
              label: 'Numbering',
              pressed: format?.listKind === 'number',
              disabled: !editing || !format?.canApplyNumber,
              stayOpen: true,
              run: () => format?.onToggleList('number'),
            },
            {
              id: 'multilevel',
              label: 'Multilevel numbering',
              pressed: format?.listKind === 'multilevel',
              disabled: !editing || !format?.canApplyMultilevel,
              stayOpen: true,
              run: () => format?.onToggleList('multilevel'),
            },
            {
              id: 'increase-indent',
              label: 'Increase list indent',
              disabled: !editing || !format?.canIndent,
              stayOpen: true,
              run: format?.onIndent,
            },
            {
              id: 'decrease-indent',
              label: 'Decrease list indent',
              disabled: !editing || !format?.canOutdent,
              stayOpen: true,
              run: format?.onOutdent,
            },
            {
              id: 'continue-list',
              label: 'Continue list',
              disabled: !editing || !format?.canContinue,
              run: format?.onContinueList,
            },
            {
              id: 'restart-numbering',
              label: 'Restart numbering',
              pressed: format?.listRestarted,
              disabled: !editing || !format?.canRestart,
              run: format?.onRestartList,
            },
          ],
        },
        {
          label: 'Classification',
          commands: markingsCommands(props.markings),
        },
      ],
    },
    {
      id: 'review',
      label: 'Review',
      groups: [
        {
          label: 'Tracking',
          commands: [
            {
              id: 'accept-change',
              label: 'Accept change',
              shortcut: 'A',
              disabled: !review || Boolean(review.targetUnavailable),
              disabledReason: review?.targetUnavailable ?? reviewAbsent,
              run: review?.onAcceptChange,
            },
            {
              id: 'reject-change',
              label: 'Reject change',
              shortcut: 'R',
              disabled: !review || Boolean(review.targetUnavailable),
              disabledReason: review?.targetUnavailable ?? reviewAbsent,
              run: review?.onRejectChange,
            },
            {
              id: 'accept-all',
              label: reviewAllLabel('Accept', review),
              disabled: !review || Boolean(review.bulkUnavailable),
              disabledReason: review?.bulkUnavailable ?? reviewAbsent,
              run: review?.onAcceptAll,
            },
            {
              id: 'reject-all',
              label: reviewAllLabel('Reject', review),
              disabled: !review || Boolean(review.bulkUnavailable),
              disabledReason: review?.bulkUnavailable ?? reviewAbsent,
              run: review?.onRejectAll,
            },
          ],
        },
        {
          label: 'Review panels',
          commands: [
            {
              id: 'changes',
              label: changeLabel(props.changeCount),
              pressed: props.changesOpen,
              stayOpen: true,
              run: props.onToggleChanges,
            },
            {
              id: 'previous-change',
              label: 'Previous change',
              shortcut: 'K',
              stayOpen: true,
              disabled: !review || !review.canPrevious,
              disabledReason: review
                ? 'There is no earlier change.'
                : reviewAbsent,
              run: review?.onPreviousChange,
            },
            {
              id: 'next-change',
              label: 'Next change',
              shortcut: 'J',
              stayOpen: true,
              disabled: !review || !review.canNext,
              disabledReason: review
                ? 'There is no later change.'
                : reviewAbsent,
              run: review?.onNextChange,
            },
          ],
        },
        {
          label: 'Checks',
          commands: [
            {
              id: 'verify',
              label: 'Verify citations',
              opensSurface: true,
              disabled: props.verify
                ? props.verify.pending || !props.verify.available
                : undefined,
              disabledReason: props.verify?.reason,
              run: () => props.onOpenVerify?.(),
            },
            {
              id: 'authorities',
              label: 'List of authorities',
              pressed: props.authoritiesOpen,
              stayOpen: true,
              run: props.onToggleAuthorities,
            },
            {
              id: 'check-terms',
              label: 'Check defined terms',
              pressed: props.legalChecks?.open === 'terms',
              disabled: !props.legalChecks,
              stayOpen: true,
              run: () => props.legalChecks?.onOpen('terms'),
            },
            {
              id: 'check-cross-references',
              label: 'Check cross-references',
              pressed: props.legalChecks?.open === 'references',
              disabled: !props.legalChecks,
              stayOpen: true,
              run: () => props.legalChecks?.onOpen('references'),
            },
          ],
        },
        {
          label: 'Proofing',
          commands: [
            {
              id: 'spelling',
              label: 'Spelling',
              pressed: props.spelling,
              hint: "Underlines words the browser's dictionary flags. No document text leaves this device, and it is not a legal correctness check.",
              stayOpen: true,
              run: props.onToggleSpelling,
            },
          ],
        },
      ],
    },
    {
      id: 'view',
      label: 'View',
      groups: [
        {
          label: 'Layout',
          commands: [
            {
              id: 'print-layout',
              label: 'Print layout',
              pressed: props.view === 'print',
              stayOpen: true,
              run: () => props.onView('print'),
            },
            {
              id: 'web-layout',
              label: 'Web layout',
              pressed: props.view === 'web',
              stayOpen: true,
              run: () => props.onView('web'),
            },
          ],
        },
        {
          label: 'Show',
          commands: [
            {
              id: 'ruler',
              label: 'Ruler',
              pressed: props.rulerOn,
              stayOpen: true,
              run: props.onToggleRuler,
            },
            {
              id: 'navigation-pane',
              label: 'Navigation pane',
              pressed: props.navOpen,
              stayOpen: true,
              run: props.onToggleNavPane,
            },
            {
              id: 'info',
              label: 'Document information',
              pressed: props.infoOpen,
              disabled: props.onToggleInfo === undefined,
              stayOpen: true,
              run: props.onToggleInfo,
            },
          ],
        },
        {
          label: 'Zoom',
          commands: [
            {
              id: 'zoom-in',
              label: 'Zoom in',
              run: () => props.onZoom(Math.min(140, props.zoom + 10)),
            },
            {
              id: 'zoom-out',
              label: 'Zoom out',
              run: () => props.onZoom(Math.max(75, props.zoom - 10)),
            },
            {
              id: 'zoom-reset',
              label: 'Actual size',
              hint: `${String(props.zoom)}% now`,
              run: () => props.onZoom(100),
            },
          ],
        },
      ],
    },
  ]
  return menus
}

/** The command list a palette searches: every command, in menu order. */
export function editorCommandList(menus: readonly EditorMenu[]) {
  return menus.flatMap((menu) =>
    menu.groups.flatMap((group) =>
      group.commands.map((command) => ({ menu, group, command })),
    ),
  )
}

/**
 * A paragraph style's stored `w:name` is often the lower-case identifier Word
 * writes internally ("heading 1", "header"). Display tidies it; the id the
 * style is applied by stays exactly as stored.
 */
export function styleDisplayName(name: string, styleId: string) {
  const label = name.trim() === '' ? styleId : name.trim()
  if (label !== label.toLowerCase()) return label
  return label
    .split(/(\s+)/u)
    .map((part) => (/^\s+$/u.test(part) ? part : capitalise(part)))
    .join('')
}

function capitalise(word: string) {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

function changeLabel(count: number) {
  return count > 0 ? `Changes (${String(count)})` : 'Changes'
}

function reviewAllLabel(
  verb: 'Accept' | 'Reject',
  review?: DocumentReviewToolbar,
) {
  return review && review.undecidableCount > 0
    ? `${verb} all supported changes`
    : `${verb} all changes`
}

function markingsCommands(
  markings: DocumentMarkingsToolbar | undefined,
): EditorCommand[] {
  const disabled =
    !markings || markings.pending || Boolean(markings.unavailable)
  const base = {
    disabled,
    disabledReason: markings?.unavailable,
    stayOpen: true,
  }
  const stored = markings?.markings.documentKind
  // A kind this build does not list is still offered as itself: the stored
  // value must never vanish from the choices that describe it.
  const kinds: ReadonlyArray<{ value: string; label: string }> =
    stored && !DOCUMENT_KINDS.some((kind) => kind.value === stored)
      ? [...DOCUMENT_KINDS, { value: stored, label: stored }]
      : DOCUMENT_KINDS
  return [
    ...kinds.map((kind) => ({
      id: `kind-${kind.value}`,
      label: kind.label,
      checked: (markings?.markings.documentKind ?? '') === kind.value,
      ...base,
      run: () => markings?.onDocumentKind(kind.value),
    })),
    {
      id: 'kind-none',
      label: 'No document type',
      checked: !markings?.markings.documentKind,
      ...base,
      run: () => markings?.onDocumentKind(null),
    },
    {
      id: 'draft',
      label: 'Draft',
      pressed: Boolean(markings?.markings.draft),
      ...base,
      run: markings?.onToggleDraft,
    },
    {
      id: 'privileged',
      label: 'Privileged',
      pressed: Boolean(markings?.markings.privileged),
      ...base,
      run: markings?.onTogglePrivileged,
    },
    {
      id: 'without-prejudice',
      label: 'Without prejudice',
      pressed: Boolean(markings?.markings.withoutPrejudice),
      ...base,
      run: markings?.onToggleWithoutPrejudice,
    },
  ]
}

const DOCUMENT_KINDS = [
  { value: 'advice', label: 'Advice' },
  { value: 'letter', label: 'Letter before action' },
  { value: 'particulars', label: 'Particulars of claim' },
  { value: 'defence', label: 'Defence' },
  { value: 'witness', label: 'Witness statement' },
  { value: 'skeleton', label: 'Skeleton argument' },
  { value: 'order', label: 'Order' },
] as const
