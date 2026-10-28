import type { ReactNode } from 'react'
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowDown,
  ArrowUp,
  ArrowsClockwise,
  ArrowsLeftRight,
  BookOpen,
  ChatText,
  Check,
  CheckCircle,
  Checks,
  ClipboardText,
  Copy,
  DownloadSimple,
  Eraser,
  EyeSlash,
  Files,
  FloppyDisk,
  FrameCorners,
  GlobeSimple,
  Hash,
  Highlighter,
  Image as ImageIcon,
  Info,
  Link,
  LinkSimple,
  ListBullets,
  ListChecks,
  ListDashes,
  ListMagnifyingGlass,
  ListNumbers,
  LockSimple,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Note,
  PencilLine,
  Plus,
  Printer,
  Prohibit,
  Ruler,
  Scales,
  Scissors,
  ShieldCheck,
  SquareSplitHorizontal,
  Swap,
  Table,
  TextAa,
  TextAlignCenter,
  TextAlignJustify,
  TextAlignLeft,
  TextAlignRight,
  TextB,
  TextIndent,
  TextItalic,
  TextOutdent,
  TextStrikethrough,
  TextSubscript,
  TextSuperscript,
  TextT,
  TextUnderline,
  Trash,
  TreeStructure,
} from '@phosphor-icons/react'
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

export type EditorMenuId =
  | 'file'
  | 'edit'
  | 'insert'
  | 'format'
  | 'review'
  | 'view'

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
  openHelp: () => void
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
  return [
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
              icon: <FloppyDisk size={14} aria-hidden />,
              shortcut: 'Ctrl S',
              disabled: !props.canSave,
              disabledReason: props.saveReason,
              run: props.onSave,
            },
            {
              id: 'info',
              label: 'Document information',
              icon: <Info size={14} aria-hidden />,
              pressed: props.infoOpen,
              disabled: props.onToggleInfo === undefined,
              disabledReason: 'The document detail is not loaded.',
              stayOpen: true,
              run: props.onToggleInfo,
            },
            {
              id: 'export',
              label: 'Export',
              icon: <DownloadSimple size={14} aria-hidden />,
              run: props.onExportText,
            },
            {
              id: 'export-share-safe',
              label: 'Share-safe export',
              icon: <LockSimple size={14} aria-hidden />,
              hint: 'Removes metadata and comments, and unlinks external hyperlinks',
              run: props.onExportShareSafe,
            },
            {
              id: 'print',
              label: 'Print',
              icon: <Printer size={14} aria-hidden />,
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
              icon: <ArrowsLeftRight size={14} aria-hidden />,
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
              icon: <EyeSlash size={14} aria-hidden />,
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
              icon: <ArrowCounterClockwise size={14} aria-hidden />,
              shortcut: 'Ctrl Z',
              disabled: !props.canEdit || !props.canUndo,
              run: props.onUndo,
            },
            {
              id: 'redo',
              label: 'Redo',
              icon: <ArrowClockwise size={14} aria-hidden />,
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
              icon: <Scissors size={14} aria-hidden />,
              shortcut: 'Ctrl X',
              disabled: !clipboard?.canCut,
              disabledReason: clipboard?.cutReason,
              run: clipboard?.onCut,
            },
            {
              id: 'copy',
              label: 'Copy',
              icon: <Copy size={14} aria-hidden />,
              shortcut: 'Ctrl C',
              disabled: !clipboard?.canCopy,
              disabledReason: clipboard?.copyReason,
              run: clipboard?.onCopy,
            },
            {
              id: 'paste',
              label: 'Paste',
              icon: <ClipboardText size={14} aria-hidden />,
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
              icon: <Plus size={14} aria-hidden />,
              disabled: !props.canEdit,
              run: props.onInsertParagraph,
            },
            {
              id: 'delete-paragraph',
              label: 'Delete paragraph',
              icon: <Trash size={14} aria-hidden />,
              disabled: !props.canEdit || props.deleteParagraphReason !== undefined,
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
              run: actions.openFind,
            },
            {
              id: 'commands',
              label: 'All commands',
              shortcut: 'Ctrl K',
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
              label: 'Page break',
              disabled: Boolean(props.breakUnavailable),
              disabledReason: props.breakUnavailable,
              run: props.onPageBreak,
            },
            {
              id: 'section-break',
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
              icon: <Table size={14} aria-hidden />,
              disabled: !structure || Boolean(structure.tableUnavailable),
              disabledReason: structure?.tableUnavailable,
              run: actions.openTable,
            },
            {
              id: 'picture',
              label: 'Picture',
              icon: <ImageIcon size={14} aria-hidden />,
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
              icon: <Link size={14} aria-hidden />,
              disabled: !structure || Boolean(structure.linkUnavailable),
              disabledReason: structure?.linkUnavailable,
              run: actions.openLink,
            },
            {
              id: 'cross-reference',
              label: 'Cross-reference',
              icon: <LinkSimple size={14} aria-hidden />,
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
              icon: <Note size={14} aria-hidden />,
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
              label: 'Table of contents',
              icon: <ListChecks size={14} aria-hidden />,
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
              label: 'Page number',
              icon: <Hash size={14} aria-hidden />,
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
              label: 'Insert authority',
              icon: <Scales size={14} aria-hidden />,
              run: props.onInsertAuthority,
            },
            {
              id: 'table-of-authorities',
              label: 'Table of authorities',
              icon: <Checks size={14} aria-hidden />,
              disabled:
                !structure || Boolean(structure.tableOfAuthoritiesUnavailable),
              disabledReason: structure?.tableOfAuthoritiesUnavailable,
              run: structure?.onInsertTableOfAuthorities,
            },
            {
              id: 'update-authorities',
              label: 'Update table of authorities',
              icon: <ArrowsClockwise size={14} aria-hidden />,
              disabled:
                !structure ||
                Boolean(structure.tableOfAuthoritiesUpdateUnavailable),
              disabledReason: structure?.tableOfAuthoritiesUpdateUnavailable,
              run: structure?.onUpdateTableOfAuthorities,
            },
            {
              id: 'mark-defined-term',
              label: 'Mark defined term',
              icon: <TextT size={14} aria-hidden />,
              disabled:
                !structure || Boolean(structure.definedTermUnavailable),
              disabledReason: structure?.definedTermUnavailable,
              run: structure?.onMarkDefinedTerm,
            },
            ...citationStyles.map((style) => ({
              id: `citation-style-${style.value}`,
              label: `Citation style: ${style.label}`,
              checked: props.onCitationStyle !== undefined
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
              label: 'Font, paragraph and page',
              icon: <TextAa size={14} aria-hidden />,
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
              icon: <TextB size={14} aria-hidden />,
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
              icon: <TextItalic size={14} aria-hidden />,
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
              icon: <TextUnderline size={14} aria-hidden />,
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
              icon: <TextStrikethrough size={14} aria-hidden />,
              pressed: Boolean(format?.strikethrough),
              disabled: !editing,
              disabledReason: format?.emphasisUnavailable,
              stayOpen: true,
              run: format?.onToggleStrikethrough,
            },
            {
              id: 'highlight',
              label: 'Highlight',
              icon: <Highlighter size={14} aria-hidden />,
              pressed: Boolean(format?.highlight && format.highlight !== 'none'),
              disabled: !editing,
              disabledReason: format?.emphasisUnavailable,
              stayOpen: true,
              run: format?.onToggleHighlight,
            },
            {
              id: 'superscript',
              label: 'Superscript',
              icon: <TextSuperscript size={14} aria-hidden />,
              pressed: format?.vertAlign === 'superscript',
              disabled: !editing,
              disabledReason: format?.emphasisUnavailable,
              stayOpen: true,
              run: format?.onToggleSuperscript,
            },
            {
              id: 'subscript',
              label: 'Subscript',
              icon: <TextSubscript size={14} aria-hidden />,
              pressed: format?.vertAlign === 'subscript',
              disabled: !editing,
              disabledReason: format?.emphasisUnavailable,
              stayOpen: true,
              run: format?.onToggleSubscript,
            },
            {
              id: 'clear-formatting',
              label: 'Clear formatting',
              icon: <Eraser size={14} aria-hidden />,
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
              icon: <ListBullets size={14} aria-hidden />,
              pressed: format?.listKind === 'bullet',
              disabled: !editing || !format?.canApplyBullet,
              stayOpen: true,
              run: () => format?.onToggleList('bullet'),
            },
            {
              id: 'numbering',
              label: 'Numbering',
              icon: <ListNumbers size={14} aria-hidden />,
              pressed: format?.listKind === 'number',
              disabled: !editing || !format?.canApplyNumber,
              stayOpen: true,
              run: () => format?.onToggleList('number'),
            },
            {
              id: 'multilevel',
              label: 'Multilevel numbering',
              icon: <TreeStructure size={14} aria-hidden />,
              pressed: format?.listKind === 'multilevel',
              disabled: !editing || !format?.canApplyMultilevel,
              stayOpen: true,
              run: () => format?.onToggleList('multilevel'),
            },
            {
              id: 'increase-indent',
              label: 'Increase list indent',
              icon: <TextIndent size={14} aria-hidden />,
              disabled: !editing || !format?.canIndent,
              stayOpen: true,
              run: format?.onIndent,
            },
            {
              id: 'decrease-indent',
              label: 'Decrease list indent',
              icon: <TextOutdent size={14} aria-hidden />,
              disabled: !editing || !format?.canOutdent,
              stayOpen: true,
              run: format?.onOutdent,
            },
            {
              id: 'continue-list',
              label: 'Continue list',
              icon: <ListChecks size={14} aria-hidden />,
              disabled: !editing || !format?.canContinue,
              run: format?.onContinueList,
            },
            {
              id: 'restart-numbering',
              label: 'Restart numbering',
              icon: <ArrowsClockwise size={14} aria-hidden />,
              pressed: format?.listRestarted,
              disabled: !editing || !format?.canRestart,
              run: format?.onRestartList,
            },
          ],
        },
        {
          label: 'Alignment',
          commands: [
            ...(
              [
                ['left', 'Align left', <TextAlignLeft size={14} aria-hidden />],
                [
                  'center',
                  'Align centre',
                  <TextAlignCenter size={14} aria-hidden />,
                ],
                [
                  'right',
                  'Align right',
                  <TextAlignRight size={14} aria-hidden />,
                ],
                ['both', 'Justify', <TextAlignJustify size={14} aria-hidden />],
              ] as const
            ).map(([value, label, icon]) => ({
              id: `align-${value}`,
              label,
              icon,
              checked: format?.alignment === value,
              disabled: !editing,
              stayOpen: true,
              run: () => format?.onAlignment(value),
            })),
          ],
        },
        {
          label: 'Page',
          commands: [
            {
              id: 'orientation',
              label: 'Landscape orientation',
              icon: <Swap size={14} aria-hidden />,
              pressed: format?.orientation === 'landscape',
              disabled: !format || Boolean(format.layoutUnavailable),
              disabledReason: format?.layoutUnavailable,
              stayOpen: true,
              run: format?.onOrientation,
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
              icon: <Check size={14} aria-hidden />,
              shortcut: 'A',
              disabled: !review || Boolean(review.targetUnavailable),
              disabledReason: review?.targetUnavailable ?? reviewAbsent,
              run: review?.onAcceptChange,
            },
            {
              id: 'reject-change',
              label: 'Reject change',
              icon: <Prohibit size={14} aria-hidden />,
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
              icon: <ListChecks size={14} aria-hidden />,
              pressed: props.changesOpen,
              stayOpen: true,
              run: props.onToggleChanges,
            },
            {
              id: 'previous-change',
              label: 'Previous change',
              icon: <ArrowUp size={14} aria-hidden />,
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
              icon: <ArrowDown size={14} aria-hidden />,
              shortcut: 'J',
              stayOpen: true,
              disabled: !review || !review.canNext,
              disabledReason: review ? 'There is no later change.' : reviewAbsent,
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
              icon: <ShieldCheck size={14} aria-hidden />,
              disabled: props.verify
                ? props.verify.pending || !props.verify.available
                : undefined,
              disabledReason: props.verify?.reason,
              run: () => props.onOpenVerify?.(),
            },
            {
              id: 'authorities',
              label: 'List of authorities',
              icon: <ListDashes size={14} aria-hidden />,
              pressed: props.authoritiesOpen,
              stayOpen: true,
              run: props.onToggleAuthorities,
            },
            {
              id: 'check-terms',
              label: 'Check defined terms',
              icon: <ListMagnifyingGlass size={14} aria-hidden />,
              pressed: props.legalChecks?.open === 'terms',
              disabled: !props.legalChecks,
              stayOpen: true,
              run: () => props.legalChecks?.onOpen('terms'),
            },
            {
              id: 'check-cross-references',
              label: 'Check cross-references',
              icon: <CheckCircle size={14} aria-hidden />,
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
              icon: <TextAa size={14} aria-hidden />,
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
              icon: <FrameCorners size={14} aria-hidden />,
              pressed: props.view === 'print',
              stayOpen: true,
              run: () => props.onView('print'),
            },
            {
              id: 'web-layout',
              label: 'Web layout',
              icon: <GlobeSimple size={14} aria-hidden />,
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
              icon: <Ruler size={14} aria-hidden />,
              pressed: props.rulerOn,
              stayOpen: true,
              run: props.onToggleRuler,
            },
            {
              id: 'navigation-pane',
              label: 'Navigation pane',
              icon: <ListDashes size={14} aria-hidden />,
              pressed: props.navOpen,
              stayOpen: true,
              run: props.onToggleNavPane,
            },
            {
              id: 'info',
              label: 'Document information',
              icon: <Info size={14} aria-hidden />,
              pressed: props.infoOpen,
              disabled: props.onToggleInfo === undefined,
              stayOpen: true,
              run: props.onToggleInfo,
            },
          ],
        },
        {
          label: 'Help',
          commands: [
            {
              id: 'shortcuts',
              label: 'Keyboard shortcuts',
              run: actions.openHelp,
            },
          ],
        },
        {
          label: 'Zoom',
          commands: [
            {
              id: 'zoom-in',
              label: 'Zoom in',
              icon: <MagnifyingGlassPlus size={14} aria-hidden />,
              run: () => props.onZoom(Math.min(140, props.zoom + 10)),
            },
            {
              id: 'zoom-out',
              label: 'Zoom out',
              icon: <MagnifyingGlassMinus size={14} aria-hidden />,
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

function commentLabel(count: number) {
  return count > 0 ? `Comments (${String(count)})` : 'Comments'
}

function changeLabel(count: number) {
  return count > 0 ? `Changes (${String(count)})` : 'Changes'
}

function reviewAllLabel(verb: 'Accept' | 'Reject', review?: DocumentReviewToolbar) {
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
  const kinds =
    stored && !DOCUMENT_KINDS.some((kind) => kind.value === stored)
      ? [...DOCUMENT_KINDS, { value: stored, label: stored }]
      : [...DOCUMENT_KINDS]
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

export type { DocumentStructureToolbar }
