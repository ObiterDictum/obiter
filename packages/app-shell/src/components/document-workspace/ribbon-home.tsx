import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ClipboardText,
  Copy,
  Drop,
  Eraser,
  Highlighter,
  ListBullets,
  ListChecks,
  ListNumbers,
  TreeStructure,
  Plus,
  Scissors,
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
  TextUnderline,
  Trash,
} from '@phosphor-icons/react'
import type { DocumentFormatToolbar } from './ribbon-types'
import {
  CaptionButton,
  IconButton,
  RibbonSelect,
  ToolbarGroup,
  ToolbarRow,
} from './ribbon-primitives'

const FONT_FACES = [
  'Calibri',
  'Cambria',
  'Times New Roman',
  'Garamond',
  'Georgia',
  'Arial',
  'Courier New',
].map((name) => ({ value: name, label: name }))

const FONT_SIZES = [
  '8',
  '9',
  '10',
  '11',
  '12',
  '14',
  '16',
  '18',
  '20',
  '24',
  '28',
  '36',
].map((size) => ({ value: size, label: size }))

const LINE_SPACING = [
  { value: '1', label: '1.0' },
  { value: '1.15', label: '1.15' },
  { value: '1.5', label: '1.5' },
  { value: '2', label: '2.0' },
]

export function HomeRibbon({
  canEdit,
  canUndo,
  format,
  onUndo,
  onInsertParagraph,
  onDeleteParagraph,
}: {
  canEdit: boolean
  canUndo?: boolean
  format?: DocumentFormatToolbar
  onUndo?: () => void
  onInsertParagraph: () => void
  onDeleteParagraph: () => void
}) {
  const editing = canEdit && Boolean(format)
  return (
    <div
      className="flex min-w-0 flex-wrap items-stretch"
      role="toolbar"
      aria-label="Home"
    >
      <ToolbarGroup label="Clipboard">
        <ToolbarRow>
          <IconButton
            label="Paste"
            soon
            icon={<ClipboardText size={16} aria-hidden />}
          />
          <IconButton
            label="Cut"
            soon
            icon={<Scissors size={16} aria-hidden />}
          />
          <IconButton label="Copy" soon icon={<Copy size={16} aria-hidden />} />
        </ToolbarRow>
      </ToolbarGroup>
      <ToolbarGroup label="Font">
        <ToolbarRow>
          <RibbonSelect
            label="Font"
            soon
            className="w-[8.5rem]"
            value="Calibri"
            options={FONT_FACES}
          />
          <RibbonSelect
            label="Font size"
            soon
            className="w-12"
            value="11"
            options={FONT_SIZES}
          />
        </ToolbarRow>
        <ToolbarRow>
          <IconButton
            label="Bold"
            pressed={format?.bold}
            disabled={!editing}
            soon={format?.emphasisUnavailable}
            onClick={format?.onToggleBold}
            icon={<TextB size={16} aria-hidden />}
          />
          <IconButton
            label="Italic"
            pressed={format?.italic}
            disabled={!editing}
            soon={format?.emphasisUnavailable}
            onClick={format?.onToggleItalic}
            icon={<TextItalic size={16} aria-hidden />}
          />
          <IconButton
            label="Underline"
            pressed={format?.underline}
            disabled={!editing}
            soon={format?.emphasisUnavailable}
            onClick={format?.onToggleUnderline}
            icon={<TextUnderline size={16} aria-hidden />}
          />
          <IconButton
            label="Strikethrough"
            soon
            icon={<TextStrikethrough size={16} aria-hidden />}
          />
          <IconButton
            label="Font colour"
            soon
            icon={<Drop size={16} aria-hidden />}
          />
          <IconButton
            label="Highlight"
            soon
            icon={<Highlighter size={16} aria-hidden />}
          />
          <IconButton
            label="Superscript"
            soon
            icon={<TextSuperscript size={16} aria-hidden />}
          />
          <IconButton
            label="Subscript"
            soon
            icon={<TextSubscript size={16} aria-hidden />}
          />
          <IconButton
            label="Clear formatting"
            soon
            icon={<Eraser size={16} aria-hidden />}
          />
        </ToolbarRow>
      </ToolbarGroup>
      <ToolbarGroup label="Paragraph">
        <ToolbarRow>
          <IconButton
            label="Multilevel numbering"
            pressed={format?.listKind === 'multilevel'}
            disabled={!editing || !format?.canApplyMultilevel}
            onClick={() => format?.onToggleList('multilevel')}
            icon={<TreeStructure size={16} aria-hidden />}
          />
          <IconButton
            label="Numbering"
            pressed={format?.listKind === 'number'}
            disabled={!editing || !format?.canApplyNumber}
            onClick={() => format?.onToggleList('number')}
            icon={<ListNumbers size={16} aria-hidden />}
          />
          <IconButton
            label="Bullets"
            pressed={format?.listKind === 'bullet'}
            disabled={!editing || !format?.canApplyBullet}
            onClick={() => format?.onToggleList('bullet')}
            icon={<ListBullets size={16} aria-hidden />}
          />
          <IconButton
            label="Increase list indent"
            disabled={!editing || !format?.canIndent}
            onClick={format?.onIndent}
            icon={<TextIndent size={16} aria-hidden />}
          />
          <IconButton
            label="Decrease list indent"
            disabled={!editing || !format?.canOutdent}
            onClick={format?.onOutdent}
            icon={<TextOutdent size={16} aria-hidden />}
          />
          <IconButton
            label="Continue list"
            disabled={!editing || !format?.canContinue}
            onClick={format?.onContinueList}
            icon={<ListChecks size={16} aria-hidden />}
          />
        </ToolbarRow>
        <ToolbarRow>
          <IconButton
            label="Align left"
            soon
            icon={<TextAlignLeft size={16} aria-hidden />}
          />
          <IconButton
            label="Align centre"
            soon
            icon={<TextAlignCenter size={16} aria-hidden />}
          />
          <IconButton
            label="Align right"
            soon
            icon={<TextAlignRight size={16} aria-hidden />}
          />
          <IconButton
            label="Justify"
            soon
            icon={<TextAlignJustify size={16} aria-hidden />}
          />
          <RibbonSelect
            label="Line spacing"
            soon
            className="w-14"
            value="1.15"
            options={LINE_SPACING}
          />
        </ToolbarRow>
      </ToolbarGroup>
      <StyleGallery format={format} />
      <ToolbarGroup label="Editing">
        <ToolbarRow>
          <IconButton
            label="Insert paragraph"
            disabled={!canEdit}
            onClick={onInsertParagraph}
            icon={<Plus size={16} aria-hidden />}
          />
          <IconButton
            label="Delete paragraph"
            disabled={!canEdit}
            onClick={onDeleteParagraph}
            icon={<Trash size={16} aria-hidden />}
          />
          <IconButton
            label="Undo"
            disabled={!canEdit || !canUndo}
            onClick={onUndo}
            icon={<ArrowCounterClockwise size={16} aria-hidden />}
          />
          <IconButton
            label="Redo"
            soon
            icon={<ArrowClockwise size={16} aria-hidden />}
          />
        </ToolbarRow>
      </ToolbarGroup>
    </div>
  )
}

const FALLBACK_STYLES = ['Normal', 'Heading 1', 'Quote', 'List Number']

function StyleGallery({ format }: { format?: DocumentFormatToolbar }) {
  if (!format || format.paragraphStyles.length === 0) {
    return (
      <ToolbarGroup label="Styles">
        <ToolbarRow>
          {FALLBACK_STYLES.map((name) => (
            <CaptionButton key={name} label={name} soon />
          ))}
        </ToolbarRow>
      </ToolbarGroup>
    )
  }
  const chips = format.paragraphStyles.slice(0, 4)
  return (
    <ToolbarGroup label="Styles">
      <ToolbarRow>
        {chips.map((style) => (
          <CaptionButton
            key={style.styleId}
            label={style.name}
            pressed={format.paragraphStyleId === style.styleId}
            onClick={() => format.onParagraphStyle(style.styleId)}
          />
        ))}
        <RibbonSelect
          label="Paragraph style"
          className="max-w-36"
          value={format.paragraphStyleId}
          options={[
            { value: '', label: 'No direct style' },
            ...format.paragraphStyles.map((style) => ({
              value: style.styleId,
              label: style.name,
            })),
          ]}
          onChange={(value) =>
            format.onParagraphStyle(value === '' ? null : value)
          }
        />
      </ToolbarRow>
    </ToolbarGroup>
  )
}
