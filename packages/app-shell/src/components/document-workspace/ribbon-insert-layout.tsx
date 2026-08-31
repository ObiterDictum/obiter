import {
  AlignBottom,
  AlignCenterVertical,
  AlignTop,
  ChatText,
  Hash,
  Image as ImageIcon,
  Link,
  LinkSimple,
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

const PAGE_SIZES = [
  { value: 'a4', label: 'A4' },
  { value: 'a5', label: 'A5' },
]

const MARGINS = [
  { value: 'normal', label: 'Normal' },
  { value: 'narrow', label: 'Narrow' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'wide', label: 'Wide' },
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

export function InsertRibbon({
  commentsOpen,
  commentCount,
  onToggleComments,
}: {
  commentsOpen: boolean
  commentCount: number
  onToggleComments: () => void
}) {
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
            soon
            icon={<AlignCenterVertical size={16} aria-hidden />}
          />
          <IconButton
            label="Section break"
            soon
            icon={<SquareSplitHorizontal size={16} aria-hidden />}
          />
        </ToolbarRow>
      </ToolbarGroup>
      <ToolbarGroup label="Tables">
        <IconButton
          label="Insert table"
          soon
          icon={<Table size={16} aria-hidden />}
        />
      </ToolbarGroup>
      <ToolbarGroup label="Exhibits">
        <IconButton
          label="Picture"
          soon
          icon={<ImageIcon size={16} aria-hidden />}
        />
      </ToolbarGroup>
      <ToolbarGroup label="Links">
        <ToolbarRow>
          <IconButton label="Link" soon icon={<Link size={16} aria-hidden />} />
          <IconButton
            label="Cross-reference"
            soon
            icon={<LinkSimple size={16} aria-hidden />}
          />
        </ToolbarRow>
      </ToolbarGroup>
      <ToolbarGroup label="Header and footer">
        <ToolbarRow>
          <IconButton
            label="Header"
            soon
            icon={<AlignTop size={16} aria-hidden />}
          />
          <IconButton
            label="Footer"
            soon
            icon={<AlignBottom size={16} aria-hidden />}
          />
          <IconButton
            label="Page number"
            soon
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
    </div>
  )
}

export function LayoutRibbon() {
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
            soon
            className="w-[5.5rem]"
            value="normal"
            options={MARGINS}
          />
          <IconButton
            label="Orientation"
            soon
            icon={<Swap size={16} aria-hidden />}
          />
          <RibbonSelect
            label="Page size"
            soon
            className="w-12"
            value="a4"
            options={PAGE_SIZES}
          />
        </ToolbarRow>
      </ToolbarGroup>
      <ToolbarGroup label="Document">
        <RibbonSelect
          label="Document type"
          soon
          className="w-[11rem]"
          value="advice"
          options={DOCUMENT_KINDS}
        />
      </ToolbarGroup>
      <ToolbarGroup label="Marking">
        <ToolbarRow>
          <CaptionButton label="Draft" soon />
          <CaptionButton label="Privileged" soon />
          <CaptionButton label="Without prejudice" soon />
        </ToolbarRow>
      </ToolbarGroup>
      <ToolbarGroup label="Paragraph">
        <RibbonSelect
          label="Indent"
          soon
          className="w-[6.5rem]"
          value="hanging"
          options={[
            { value: 'none', label: 'None' },
            { value: 'first', label: 'First line' },
            { value: 'hanging', label: 'Hanging' },
          ]}
        />
      </ToolbarGroup>
    </div>
  )
}
