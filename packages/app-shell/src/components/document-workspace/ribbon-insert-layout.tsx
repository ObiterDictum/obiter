import { useState } from 'react'
import {
  AlignBottom,
  AlignCenterVertical,
  AlignTop,
  ChatText,
  Hash,
  Image as ImageIcon,
  Link,
  LinkSimple,
  Note,
  SquareSplitHorizontal,
  Swap,
  Table,
} from '@phosphor-icons/react'
import {
  CaptionButton,
  IconButton,
  RibbonSelect,
  ToolbarGroup,
  ToolbarRow,
} from './ribbon-primitives'
import { INDENT_OPTIONS } from '../../document-paragraph-format'
import {
  PAGE_SIZE_OPTIONS,
  SECTION_MARGINS_OPTIONS,
} from '../../document-section-format'
import { InsertTableDialog } from './insert-table-dialog'
import { InsertLinkDialog } from './insert-link-dialog'
import { InsertCrossReferenceDialog } from './insert-cross-reference-dialog'
import type {
  DocumentFormatToolbar,
  DocumentMarkingsToolbar,
  DocumentStructureToolbar,
} from './ribbon-types'

const MARGIN_OPTIONS = [
  { value: '', label: 'Custom' },
  ...SECTION_MARGINS_OPTIONS,
]

const PAGE_SIZE_SELECT_OPTIONS = [
  { value: '', label: 'Custom' },
  ...PAGE_SIZE_OPTIONS,
]

const DOCUMENT_KINDS = [
  { value: 'advice', label: 'Advice' },
  { value: 'letter', label: 'Letter before action' },
  { value: 'particulars', label: 'Particulars of claim' },
  { value: 'defence', label: 'Defence' },
  { value: 'witness', label: 'Witness statement' },
  { value: 'skeleton', label: 'Skeleton argument' },
  { value: 'order', label: 'Order' },
]

const NO_DOCUMENT_KIND = { value: '', label: 'No type set' }

/**
 * The stored kind first: a kind this deployment does not list still shows as
 * itself rather than snapping the select to a value it never chose, and the
 * user can clear it or re-pick without the stored value being lost on sight.
 */
function documentKindOptions(kind: string | null) {
  const options = [...DOCUMENT_KINDS]
  if (kind !== null && !options.some((option) => option.value === kind)) {
    options.push({ value: kind, label: kind })
  }
  return [NO_DOCUMENT_KIND, ...options]
}

export function InsertRibbon({
  commentsOpen,
  commentCount,
  onToggleComments,
  onPageBreak,
  onSectionBreak,
  breakUnavailable,
  structure,
}: {
  commentsOpen: boolean
  commentCount: number
  onToggleComments: () => void
  onPageBreak: () => void
  onSectionBreak: () => void
  /** Set when a break cannot be placed at the current caret. */
  breakUnavailable?: string
  /** The table and picture controls; absent while the document is unloaded. */
  structure?: DocumentStructureToolbar
}) {
  const breaksDisabled = Boolean(breakUnavailable)
  const [tableOpen, setTableOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [crossReferenceOpen, setCrossReferenceOpen] = useState(false)
  return (
    <div
      className="flex min-w-0 flex-wrap items-stretch"
      role="toolbar"
      aria-label="Insert"
    >
      <ToolbarGroup label="Breaks">
        <ToolbarRow>
          <IconButton
            label="Page break"
            disabled={breaksDisabled}
            disabledReason={breakUnavailable}
            onClick={onPageBreak}
            icon={<AlignCenterVertical size={16} aria-hidden />}
          />
          <IconButton
            label="Section break"
            disabled={breaksDisabled}
            disabledReason={breakUnavailable}
            onClick={onSectionBreak}
            icon={<SquareSplitHorizontal size={16} aria-hidden />}
          />
        </ToolbarRow>
      </ToolbarGroup>
      <ToolbarGroup label="Tables">
        <IconButton
          label="Insert table"
          disabled={!structure || Boolean(structure.tableUnavailable)}
          disabledReason={structure?.tableUnavailable}
          onClick={() => setTableOpen(true)}
          icon={<Table size={16} aria-hidden />}
        />
        {structure?.picturePicker}
      </ToolbarGroup>
      <ToolbarGroup label="Exhibits">
        <IconButton
          label="Picture"
          disabled={!structure || Boolean(structure.pictureUnavailable)}
          disabledReason={structure?.pictureUnavailable}
          onClick={structure?.onInsertPicture}
          icon={<ImageIcon size={16} aria-hidden />}
        />
      </ToolbarGroup>
      <ToolbarGroup label="Links">
        <ToolbarRow>
          <IconButton
            label="Link"
            disabled={!structure || Boolean(structure.linkUnavailable)}
            disabledReason={structure?.linkUnavailable}
            onClick={() => setLinkOpen(true)}
            icon={<Link size={16} aria-hidden />}
          />
          <IconButton
            label="Cross-reference"
            disabled={
              !structure || Boolean(structure.crossReferenceUnavailable)
            }
            disabledReason={structure?.crossReferenceUnavailable}
            onClick={() => setCrossReferenceOpen(true)}
            icon={<LinkSimple size={16} aria-hidden />}
          />
        </ToolbarRow>
      </ToolbarGroup>
      <ToolbarGroup label="Notes">
        <IconButton
          label={
            structure?.editingStoryKind === 'footnotes'
              ? 'Close footnotes'
              : 'Footnote'
          }
          pressed={structure?.editingStoryKind === 'footnotes'}
          disabled={
            !structure ||
            (structure.editingStoryKind !== 'footnotes' &&
              Boolean(structure.footnoteUnavailable))
          }
          disabledReason={structure?.footnoteUnavailable}
          onClick={() => {
            if (structure?.editingStoryKind === 'footnotes') {
              structure.onCloseStory()
            } else {
              structure?.onInsertFootnote()
            }
          }}
          icon={<Note size={16} aria-hidden />}
        />
      </ToolbarGroup>
      <ToolbarGroup label="Header and footer">
        <ToolbarRow>
          <IconButton
            label={
              structure?.editingStoryKind === 'header'
                ? 'Close header'
                : 'Header'
            }
            pressed={structure?.editingStoryKind === 'header'}
            disabled={
              !structure ||
              (structure.editingStoryKind !== 'header' &&
                Boolean(structure.headerUnavailable))
            }
            disabledReason={structure?.headerUnavailable}
            onClick={() => {
              if (structure?.editingStoryKind === 'header') {
                structure.onCloseStory()
              } else {
                structure?.onOpenStory('header')
              }
            }}
            icon={<AlignTop size={16} aria-hidden />}
          />
          <IconButton
            label={
              structure?.editingStoryKind === 'footer'
                ? 'Close footer'
                : 'Footer'
            }
            pressed={structure?.editingStoryKind === 'footer'}
            disabled={
              !structure ||
              (structure.editingStoryKind !== 'footer' &&
                Boolean(structure.footerUnavailable))
            }
            disabledReason={structure?.footerUnavailable}
            onClick={() => {
              if (structure?.editingStoryKind === 'footer') {
                structure.onCloseStory()
              } else {
                structure?.onOpenStory('footer')
              }
            }}
            icon={<AlignBottom size={16} aria-hidden />}
          />
          <IconButton
            label="Page number"
            disabled={!structure || Boolean(structure.pageNumberUnavailable)}
            disabledReason={structure?.pageNumberUnavailable}
            onClick={structure?.onInsertPageNumber}
            icon={<Hash size={16} aria-hidden />}
          />
        </ToolbarRow>
      </ToolbarGroup>
      <ToolbarGroup label="Comments">
        <IconButton
          label={commentCount > 0 ? `Comments (${commentCount})` : 'Comments'}
          pressed={commentsOpen}
          onClick={onToggleComments}
          icon={<ChatText size={16} aria-hidden />}
        />
      </ToolbarGroup>
      <InsertTableDialog
        open={tableOpen}
        onOpenChange={setTableOpen}
        onInsert={(rows, columns) => structure?.onInsertTable(rows, columns)}
      />
      <InsertLinkDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        onInsert={(target) =>
          structure?.onInsertLink(target) ?? {
            inserted: false,
            reason: 'The document is still loading.',
          }
        }
      />
      <InsertCrossReferenceDialog
        open={crossReferenceOpen}
        onOpenChange={setCrossReferenceOpen}
        targets={structure?.crossReferenceTargets ?? []}
        onInsert={(targetParagraphId) =>
          structure?.onInsertCrossReference(targetParagraphId) ?? {
            inserted: false,
            reason: 'The document is still loading.',
          }
        }
      />
    </div>
  )
}

export function LayoutRibbon({
  format,
  markings,
}: {
  format?: DocumentFormatToolbar
  markings?: DocumentMarkingsToolbar
}) {
  return (
    <div
      className="flex min-w-0 flex-wrap items-stretch"
      role="toolbar"
      aria-label="Layout"
    >
      <ToolbarGroup label="Page setup">
        <ToolbarRow>
          <RibbonSelect
            label="Margins"
            className="w-[5.5rem]"
            value={format?.marginsKind ?? ''}
            options={MARGIN_OPTIONS}
            disabled={!format || Boolean(format.layoutUnavailable)}
            disabledReason={format?.layoutUnavailable}
            onChange={(value) => {
              const option = SECTION_MARGINS_OPTIONS.find(
                (item) => item.value === value,
              )
              if (option) format?.onMargins(option.value)
            }}
          />
          <IconButton
            label="Orientation"
            pressed={format?.orientation === 'landscape'}
            disabled={!format || Boolean(format.layoutUnavailable)}
            disabledReason={format?.layoutUnavailable}
            onClick={() => format?.onOrientation()}
            icon={<Swap size={16} aria-hidden />}
          />
          <RibbonSelect
            label="Page size"
            className="w-20"
            value={format?.pageSizeKind ?? ''}
            options={PAGE_SIZE_SELECT_OPTIONS}
            disabled={!format || Boolean(format.layoutUnavailable)}
            disabledReason={format?.layoutUnavailable}
            onChange={(value) => {
              const option = PAGE_SIZE_OPTIONS.find(
                (item) => item.value === value,
              )
              if (option) format?.onPageSize(option.value)
            }}
          />
        </ToolbarRow>
      </ToolbarGroup>
      <ToolbarGroup label="Document">
        <RibbonSelect
          label="Document type"
          className="w-[11rem]"
          value={markings?.markings.documentKind ?? ''}
          options={documentKindOptions(markings?.markings.documentKind ?? null)}
          disabled={
            !markings || markings.pending || Boolean(markings.unavailable)
          }
          disabledReason={markings?.unavailable}
          onChange={(value) =>
            markings?.onDocumentKind(value === '' ? null : value)
          }
        />
      </ToolbarGroup>
      <ToolbarGroup label="Marking">
        <ToolbarRow>
          <CaptionButton
            label="Draft"
            pressed={markings?.markings.draft}
            disabled={
              !markings || markings.pending || Boolean(markings.unavailable)
            }
            disabledReason={markings?.unavailable}
            onClick={markings?.onToggleDraft}
          />
          <CaptionButton
            label="Privileged"
            pressed={markings?.markings.privileged}
            disabled={
              !markings || markings.pending || Boolean(markings.unavailable)
            }
            disabledReason={markings?.unavailable}
            onClick={markings?.onTogglePrivileged}
          />
          <CaptionButton
            label="Without prejudice"
            pressed={markings?.markings.withoutPrejudice}
            disabled={
              !markings || markings.pending || Boolean(markings.unavailable)
            }
            disabledReason={markings?.unavailable}
            onClick={markings?.onToggleWithoutPrejudice}
          />
        </ToolbarRow>
      </ToolbarGroup>
      <ToolbarGroup label="Paragraph">
        <RibbonSelect
          label="Indent"
          className="w-[6.5rem]"
          value={format?.indentKind ?? ''}
          options={INDENT_OPTIONS}
          disabled={!format}
          onChange={(value) => {
            const option = INDENT_OPTIONS.find((item) => item.value === value)
            if (option) format?.onIndentKind(option.value)
          }}
        />
      </ToolbarGroup>
    </div>
  )
}
