import type { ReactNode } from 'react'
import {
  AlignBottom,
  AlignTop,
  ArrowsClockwise,
  ArrowsInSimple,
  Bookmarks,
  BookOpen,
  Browser,
  CaretLeft,
  CaretRight,
  Check,
  CheckCircle,
  Columns,
  FileDoc,
  GridNine,
  Hash,
  Image,
  Info,
  Link,
  ListBullets,
  ListChecks,
  ListDashes,
  ListNumbers,
  MagnifyingGlass,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  NotePencil,
  PencilSimple,
  Ruler,
  Scales,
  Scissors,
  ShieldCheck,
  SidebarSimple,
  Table,
  Tag,
  TextAa,
  TextAlignCenter,
  TextAlignJustify,
  TextAlignLeft,
  TextAlignRight,
  TextB,
  TextItalic,
  TextUnderline,
  TreeStructure,
  X,
  XCircle,
} from '@obiter/ui/icons'

import type { CitationStyle } from '../../document-preferences'
import type { LegalChecksFocus } from './ribbon-types'
import type {
  DocumentClipboardToolbar,
  DocumentFindToolbar,
  DocumentFormatToolbar,
  DocumentMarkingsToolbar,
  DocumentReviewToolbar,
} from './ribbon-types'
import type { InsertRibbonProps } from './use-insert-ribbon'
import type { PictureSizeControl } from './picture-size-toolbar'
import { revealDocumentRedactionRuns } from './document-actions'

export type EditorMenuId =
  'file' | 'edit' | 'insert' | 'format' | 'review' | 'view'

export type EditorCommandHost = 'quick-access' | 'font-panel'

export type EditorCommand = {
  id: string
  label: string
  status?: string
  icon?: ReactNode
  shortcut?: readonly string[]
  hint?: string
  pressed?: boolean
  checked?: boolean
  disabled?: boolean
  disabledReason?: string
  soon?: boolean | string
  stayOpen?: boolean
  opensSurface?: boolean
  menuOnly?: boolean
  host?: EditorCommandHost
  run?: () => void
}

export type EditorMenuGroup = {
  label: string
  commands: EditorCommand[]
  select?: { label?: string; placeholder?: string }
  dropdown?: { label: string; icon: ReactNode }
}

export type EditorMenu = {
  id: EditorMenuId
  label: string
  groups: readonly EditorMenuGroup[]
}

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
  onInsertAuthorityText: (citation: string) => void
  canInsertAuthority: boolean
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
  picture?: PictureSizeControl
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
  onOpenCompare?: () => void
  verify?: {
    available: boolean
    reason: string
    pending: boolean
    label?: string
    detail?: string
    onCheck?: () => void
  }
  onSave: () => void
  canSave: boolean
  saveReason?: string
}

export type EditorChromeActions = {
  openFormatting: () => void
  openFind: () => void
  openPalette: () => void
  openTable: () => void
  openLink: () => void
  openCrossReference: () => void
  openAuthority: () => void
  closeStory: () => void
}

const EDITING_HINT = 'Requires an editable document.'

export function editorMenus(
  props: EditorChromeProps,
  actions: EditorChromeActions,
): EditorMenu[] {
  const { format, clipboard, review, structure, find } = props
  const editing = props.canEdit && Boolean(format)
  const styles = format?.paragraphStyles ?? []
  const stylesReason =
    styles.length === 0
      ? 'This document has no paragraph styles.'
      : EDITING_HINT
  const stylesUnavailable = !editing || styles.length === 0
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
              shortcut: ['primary', 'S'],
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
              shortcut: ['primary', 'P'],
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
              shortcut: ['primary', 'Z'],
              host: 'quick-access',
              disabled: !props.canEdit || !props.canUndo,
              run: props.onUndo,
            },
            {
              id: 'redo',
              label: 'Redo',
              shortcut: ['primary', 'shift', 'Z'],
              host: 'quick-access',
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
              shortcut: ['primary', 'X'],
              disabled: !clipboard?.canCut,
              disabledReason: clipboard?.cutReason,
              run: clipboard?.onCut,
            },
            {
              id: 'copy',
              label: 'Copy',
              shortcut: ['primary', 'C'],
              disabled: !clipboard?.canCopy,
              disabledReason: clipboard?.copyReason,
              run: clipboard?.onCopy,
            },
            {
              id: 'paste',
              label: 'Paste',
              shortcut: ['primary', 'V'],
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
              shortcut: ['primary', 'F'],
              hint: find ? undefined : EDITING_HINT,
              disabled: !find,
              opensSurface: true,
              run: actions.openFind,
            },
            {
              id: 'commands',
              label: 'All commands',
              shortcut: ['primary', 'K'],
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
              icon: <Scissors size={16} aria-hidden />,
              disabled: Boolean(props.breakUnavailable),
              disabledReason: props.breakUnavailable,
              run: props.onPageBreak,
            },
            {
              id: 'section-break',
              stayOpen: true,
              label: 'Section break',
              icon: <Columns size={16} aria-hidden />,
              disabled: Boolean(props.breakUnavailable),
              disabledReason: props.breakUnavailable,
              run: props.onSectionBreak,
            },
          ],
        },
        {
          label: 'Tables and pictures',
          dropdown: {
            label: 'Table tools',
            icon: <GridNine size={16} aria-hidden />,
          },
          commands: [
            {
              id: 'table',
              label: 'Insert table',
              icon: <Table size={16} aria-hidden />,
              opensSurface: true,
              disabled: !structure || Boolean(structure.tableUnavailable),
              disabledReason: structure?.tableUnavailable,
              run: actions.openTable,
            },
            {
              id: 'picture',
              stayOpen: true,
              label: 'Picture',
              icon: <Image size={16} aria-hidden />,
              disabled: !structure || Boolean(structure.pictureUnavailable),
              disabledReason: structure?.pictureUnavailable,
              run: structure?.onInsertPicture,
            },
            ...(
              [
                ['Insert row above', 'insert_table_row', 'before'],
                ['Insert row below', 'insert_table_row', 'after'],
                ['Insert column left', 'insert_table_column', 'before'],
                ['Insert column right', 'insert_table_column', 'after'],
                ['Delete row', 'delete_table_row'],
                ['Delete column', 'delete_table_column'],
                ['Delete table', 'delete_table'],
              ] as const
            ).map(([label, type, position]) => ({
              id: type + (position ?? ''),
              label,
              menuOnly: true,
              disabled:
                !structure?.onTableStructure ||
                Boolean(structure.tableStructureUnavailable),
              disabledReason: structure?.tableStructureUnavailable,
              run: () => {
                if (
                  type === 'insert_table_row' ||
                  type === 'insert_table_column'
                )
                  structure?.onTableStructure?.({
                    type,
                    position: position ?? 'after',
                    paragraphId: '',
                  })
                else structure?.onTableStructure?.({ type, paragraphId: '' })
              },
            })),
          ],
        },
        {
          label: 'Links',
          commands: [
            {
              id: 'link',
              label: 'Link',
              icon: <Link size={16} aria-hidden />,
              opensSurface: true,
              disabled: !structure || Boolean(structure.linkUnavailable),
              disabledReason: structure?.linkUnavailable,
              run: actions.openLink,
            },
            {
              id: 'cross-reference',
              label: 'Cross-reference',
              icon: <Bookmarks size={16} aria-hidden />,
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
              label: story === 'footnotes' ? 'Close footnotes' : 'Footnote',
              icon: <NotePencil size={16} aria-hidden />,
              shortcut:
                story === 'footnotes' ? undefined : ['primary', 'alt', 'F'],
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
              icon: <ListDashes size={16} aria-hidden />,
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
              icon: <AlignTop size={16} aria-hidden />,
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
              icon: <AlignBottom size={16} aria-hidden />,
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
              icon: <Hash size={16} aria-hidden />,
              disabled: !structure || Boolean(structure.pageNumberUnavailable),
              disabledReason: structure?.pageNumberUnavailable,
              run: structure?.onInsertPageNumber,
            },
          ],
        },
        {
          label: 'Authorities',
          dropdown: {
            label: 'Authorities',
            icon: <Scales size={16} aria-hidden />,
          },
          commands: [
            {
              id: 'insert-authority',
              stayOpen: true,
              opensSurface: true,
              menuOnly: true,
              label: 'Insert authority',
              icon: <Scales size={16} aria-hidden />,
              run: actions.openAuthority,
            },
            {
              id: 'table-of-authorities',
              label: 'Table of authorities',
              icon: <BookOpen size={16} aria-hidden />,
              menuOnly: true,
              disabled:
                !structure || Boolean(structure.tableOfAuthoritiesUnavailable),
              disabledReason: structure?.tableOfAuthoritiesUnavailable,
              run: structure?.onInsertTableOfAuthorities,
            },
            {
              id: 'update-authorities',
              label: 'Update table of authorities',
              icon: <ArrowsClockwise size={16} aria-hidden />,
              menuOnly: true,
              disabled:
                !structure ||
                Boolean(structure.tableOfAuthoritiesUpdateUnavailable),
              disabledReason: structure?.tableOfAuthoritiesUpdateUnavailable,
              run: structure?.onUpdateTableOfAuthorities,
            },
            {
              id: 'mark-defined-term',
              label: 'Mark defined term',
              icon: <Tag size={16} aria-hidden />,
              menuOnly: true,
              disabled: !structure || Boolean(structure.definedTermUnavailable),
              disabledReason: structure?.definedTermUnavailable,
              run: structure?.onMarkDefinedTerm,
            },
          ],
        },
        {
          label: 'Citation style',
          select: { label: 'Citation style' },
          commands: citationStyles.map((style) => ({
            id: `citation-style-${style.value}`,
            label: style.label,
            checked: props.citationStyle === style.value,
            disabled: props.onCitationStyle === undefined,
            disabledReason: 'Citation style is not available here.',
            run: () => props.onCitationStyle?.(style.value),
          })),
        },
      ],
    },
    {
      id: 'format',
      label: 'Format',
      groups: [
        {
          label: 'Styles',
          select: {
            label: 'Paragraph style',
            placeholder: format?.paragraphStyleMixed
              ? 'Mixed styles'
              : undefined,
          },
          commands: [
            ...styles.map((style) => ({
              id: `style-${style.styleId}`,
              label: styleDisplayName(style.name, style.styleId),
              checked:
                !format?.paragraphStyleMixed &&
                format?.paragraphStyleId === style.styleId,
              disabled: stylesUnavailable,
              disabledReason: stylesReason,
              run: () => format?.onParagraphStyle(style.styleId),
            })),
            {
              id: 'style-none',
              label: 'No direct style',
              checked:
                !format?.paragraphStyleMixed && !format?.paragraphStyleId,
              disabled: stylesUnavailable,
              disabledReason: stylesReason,
              run: () => format?.onParagraphStyle(null),
            },
          ],
        },
        {
          label: 'Character',
          commands: [
            {
              id: 'bold',
              label: 'Bold',
              icon: <TextB size={16} aria-hidden />,
              shortcut: ['primary', 'B'],
              pressed: Boolean(format?.bold),
              disabled: !editing || Boolean(format?.emphasisUnavailable),
              disabledReason: format?.emphasisUnavailable,
              run: format?.onToggleBold,
            },
            {
              id: 'italic',
              label: 'Italic',
              icon: <TextItalic size={16} aria-hidden />,
              shortcut: ['primary', 'I'],
              pressed: Boolean(format?.italic),
              disabled: !editing,
              disabledReason: format?.emphasisUnavailable,
              run: format?.onToggleItalic,
            },
            {
              id: 'underline',
              label: 'Underline',
              icon: <TextUnderline size={16} aria-hidden />,
              shortcut: ['primary', 'U'],
              pressed: Boolean(format?.underline),
              disabled: !editing,
              disabledReason: format?.emphasisUnavailable,
              run: format?.onToggleUnderline,
            },
            {
              id: 'strikethrough',
              label: 'Strikethrough',
              host: 'font-panel',
              pressed: Boolean(format?.strikethrough),
              disabled: !editing,
              disabledReason: format?.emphasisUnavailable,
              run: format?.onToggleStrikethrough,
            },
            {
              id: 'highlight',
              label: 'Highlight',
              host: 'font-panel',
              pressed: Boolean(
                format?.highlight && format.highlight !== 'none',
              ),
              disabled: !editing,
              disabledReason: format?.emphasisUnavailable,
              run: format?.onToggleHighlight,
            },
            {
              id: 'superscript',
              label: 'Superscript',
              host: 'font-panel',
              pressed: format?.vertAlign === 'superscript',
              disabled: !editing,
              disabledReason: format?.emphasisUnavailable,
              run: format?.onToggleSuperscript,
            },
            {
              id: 'subscript',
              label: 'Subscript',
              host: 'font-panel',
              pressed: format?.vertAlign === 'subscript',
              disabled: !editing,
              disabledReason: format?.emphasisUnavailable,
              run: format?.onToggleSubscript,
            },
            {
              id: 'clear-formatting',
              label: 'Clear formatting',
              host: 'font-panel',
              disabled: !editing,
              disabledReason: format?.emphasisUnavailable,
              run: format?.onClearFormatting,
            },
          ],
        },
        {
          label: 'Paragraph',
          commands: alignmentCommands(format, editing),
        },
        {
          label: 'Lists',
          commands: [
            {
              id: 'bullets',
              label: 'Bullets',
              icon: <ListBullets size={16} aria-hidden />,
              pressed: format?.listKind === 'bullet',
              disabled: !editing || !format?.canApplyBullet,
              run: () => format?.onToggleList('bullet'),
            },
            {
              id: 'numbering',
              label: 'Numbering',
              icon: <ListNumbers size={16} aria-hidden />,
              pressed: format?.listKind === 'number',
              disabled: !editing || !format?.canApplyNumber,
              run: () => format?.onToggleList('number'),
            },
            {
              id: 'multilevel',
              label: 'Multilevel numbering',
              host: 'font-panel',
              pressed: format?.listKind === 'multilevel',
              disabled: !editing || !format?.canApplyMultilevel,
              run: () => format?.onToggleList('multilevel'),
            },
            {
              id: 'increase-indent',
              label: 'Increase list indent',
              host: 'font-panel',
              disabled: !editing || !format?.canIndent,
              run: format?.onIndent,
            },
            {
              id: 'decrease-indent',
              label: 'Decrease list indent',
              host: 'font-panel',
              disabled: !editing || !format?.canOutdent,
              run: format?.onOutdent,
            },
            {
              id: 'continue-list',
              label: 'Continue list',
              host: 'font-panel',
              disabled: !editing || !format?.canContinue,
              run: format?.onContinueList,
            },
            {
              id: 'restart-numbering',
              label: 'Restart numbering',
              host: 'font-panel',
              pressed: format?.listRestarted,
              disabled: !editing || !format?.canRestart,
              run: format?.onRestartList,
            },
          ],
        },
        {
          label: 'Markings',
          commands: markingsCommands(props.markings),
        },
        {
          label: 'Formatting',
          commands: [
            {
              id: 'formatting-panel',
              label: 'Font, paragraph and page',
              opensSurface: true,
              disabled: !editing,
              disabledReason: EDITING_HINT,
              run: actions.openFormatting,
            },
          ],
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
              id: 'track-changes',
              label: 'Track changes',
              icon: <PencilSimple size={16} aria-hidden />,
              pressed: props.trackChanges,
              disabled: !props.canEdit,
              disabledReason: EDITING_HINT,
              stayOpen: true,
              run: props.onToggleTrackChanges,
            },
            {
              id: 'accept-change',
              label: 'Accept change',
              icon: <Check size={16} aria-hidden />,
              shortcut: ['A'],
              disabled: !review || Boolean(review.targetUnavailable),
              disabledReason: review?.targetUnavailable ?? reviewAbsent,
              run: review?.onAcceptChange,
            },
            {
              id: 'reject-change',
              label: 'Reject change',
              icon: <X size={16} aria-hidden />,
              shortcut: ['R'],
              disabled: !review || Boolean(review.targetUnavailable),
              disabledReason: review?.targetUnavailable ?? reviewAbsent,
              run: review?.onRejectChange,
            },
            {
              id: 'accept-all',
              label: reviewAllLabel('Accept', review),
              icon: <CheckCircle size={16} aria-hidden />,
              disabled: !review || Boolean(review.bulkUnavailable),
              disabledReason: review?.bulkUnavailable ?? reviewAbsent,
              run: review?.onAcceptAll,
            },
            {
              id: 'reject-all',
              label: reviewAllLabel('Reject', review),
              icon: <XCircle size={16} aria-hidden />,
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
              id: 'comments',
              label:
                props.commentCount > 0
                  ? `Comments (${String(props.commentCount)})`
                  : 'Comments',
              pressed: props.commentsOpen,
              run: props.onToggleComments,
            },
            {
              id: 'changes',
              label: changeLabel(props.changeCount),
              pressed: props.changesOpen,
              run: props.onToggleChanges,
            },
            {
              id: 'previous-change',
              label: 'Previous change',
              icon: <CaretLeft size={16} aria-hidden />,
              shortcut: ['K'],
              disabled: !review || !review.canPrevious,
              disabledReason: review
                ? 'There is no earlier change.'
                : reviewAbsent,
              run: review?.onPreviousChange,
            },
            {
              id: 'next-change',
              label: 'Next change',
              icon: <CaretRight size={16} aria-hidden />,
              shortcut: ['J'],
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
              icon: <ShieldCheck size={16} aria-hidden />,
              opensSurface: true,
              status: props.verify?.label,
              disabled: props.verify === undefined,
              disabledReason:
                'Verification is not available for this document.',
              run: () => props.onOpenVerify?.(),
            },
            {
              id: 'check-citations',
              label: 'Check citations',
              icon: <MagnifyingGlass size={16} aria-hidden />,
              hint: props.verify?.detail,
              disabled: props.verify
                ? props.verify.pending ||
                  !props.verify.available ||
                  props.verify.onCheck === undefined
                : true,
              disabledReason: props.verify?.reason,
              run: props.verify?.onCheck,
            },
            {
              id: 'authorities',
              label: 'List of authorities',
              icon: <BookOpen size={16} aria-hidden />,
              pressed: props.authoritiesOpen,
              stayOpen: true,
              run: props.onToggleAuthorities,
            },
            {
              id: 'check-terms',
              label: 'Check defined terms',
              icon: <ListChecks size={16} aria-hidden />,
              pressed: props.legalChecks?.open === 'terms',
              disabled: !props.legalChecks,
              stayOpen: true,
              run: () => props.legalChecks?.onOpen('terms'),
            },
            {
              id: 'check-cross-references',
              label: 'Check cross-references',
              icon: <TreeStructure size={16} aria-hidden />,
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
              icon: <TextAa size={16} aria-hidden />,
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
              icon: <FileDoc size={16} aria-hidden />,
              pressed: props.view === 'print',
              stayOpen: true,
              run: () => props.onView('print'),
            },
            {
              id: 'web-layout',
              label: 'Web layout',
              icon: <Browser size={16} aria-hidden />,
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
              icon: <Ruler size={16} aria-hidden />,
              pressed: props.rulerOn,
              stayOpen: true,
              run: props.onToggleRuler,
            },
            {
              id: 'navigation-pane',
              label: 'Navigation pane',
              icon: <SidebarSimple size={16} aria-hidden />,
              pressed: props.navOpen,
              stayOpen: true,
              run: props.onToggleNavPane,
            },
            {
              id: 'info',
              label: 'Document information',
              icon: <Info size={16} aria-hidden />,
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
              icon: <MagnifyingGlassPlus size={16} aria-hidden />,
              run: () => props.onZoom(Math.min(140, props.zoom + 10)),
            },
            {
              id: 'zoom-out',
              label: 'Zoom out',
              icon: <MagnifyingGlassMinus size={16} aria-hidden />,
              run: () => props.onZoom(Math.max(75, props.zoom - 10)),
            },
            {
              id: 'zoom-reset',
              label: 'Actual size',
              icon: <ArrowsInSimple size={16} aria-hidden />,
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

export function editorCommandList(menus: readonly EditorMenu[]) {
  return menus.flatMap((menu) =>
    menu.groups.flatMap((group) =>
      group.commands.map((command) => ({ menu, group, command })),
    ),
  )
}

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

function alignmentCommands(
  format: DocumentFormatToolbar | undefined,
  editing: boolean,
): EditorCommand[] {
  const alignments = [
    { value: 'left', label: 'Align left', icon: TextAlignLeft },
    { value: 'center', label: 'Align centre', icon: TextAlignCenter },
    { value: 'right', label: 'Align right', icon: TextAlignRight },
    { value: 'both', label: 'Justify', icon: TextAlignJustify },
  ] as const
  return alignments.map(({ value, label, icon: Icon }) => ({
    id: `align-${value}`,
    label,
    icon: <Icon size={16} aria-hidden />,
    pressed: format?.alignment === value,
    disabled: !editing,
    disabledReason: EDITING_HINT,
    run: () => format?.onAlignment(value),
  }))
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
    host: 'font-panel' as const,
  }
  const stored = markings?.markings.documentKind
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
