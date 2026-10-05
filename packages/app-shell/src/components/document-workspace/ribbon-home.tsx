import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ClipboardText,
  Copy,
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
import type {
  DocumentFormatToolbar,
  DocumentClipboardToolbar,
} from './ribbon-types'
import { LINE_SPACING_OPTIONS } from '../../document-paragraph-format'
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

// The contract carries a font size in half-points, so the option value is
// twice the point label the user sees.
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
].map((size) => ({ value: String(Number(size) * 2), label: size }))

// Hex without the leading `#`, matching the contract's colour pattern.
const FONT_COLOURS = [
  { value: '000000', label: 'Black' },
  { value: 'C00000', label: 'Dark red' },
  { value: 'FF0000', label: 'Red' },
  { value: '0070C0', label: 'Blue' },
  { value: '00B050', label: 'Green' },
]

const DEFAULT_FONT = { value: '', label: 'Default font' }
const DEFAULT_SIZE = { value: '', label: 'Default size' }
const DEFAULT_COLOUR = { value: '', label: 'Automatic' }

export function HomeRibbon({
  canEdit,
  canUndo,
  canRedo,
  format,
  clipboard,
  deleteParagraphReason,
  onUndo,
  onRedo,
  onInsertParagraph,
  onDeleteParagraph,
}: {
  canEdit: boolean
  canUndo?: boolean
  canRedo?: boolean
  format?: DocumentFormatToolbar
  clipboard?: DocumentClipboardToolbar
  /** Set when the effective document has one paragraph: the accessible reason
   * Delete paragraph is unavailable rather than an unexplained disabled state. */
  deleteParagraphReason?: string
  onUndo?: () => void
  onRedo?: () => void
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
            soon={!clipboard}
            disabled={!clipboard?.canPaste}
            disabledReason={clipboard?.pasteReason}
            onClick={clipboard?.onPaste}
            icon={<ClipboardText size={16} aria-hidden />}
          />
          <IconButton
            label="Cut"
            soon={!clipboard}
            disabled={!clipboard?.canCut}
            disabledReason={clipboard?.cutReason}
            onClick={clipboard?.onCut}
            icon={<Scissors size={16} aria-hidden />}
          />
          <IconButton
            label="Copy"
            soon={!clipboard}
            disabled={!clipboard?.canCopy}
            disabledReason={clipboard?.copyReason}
            onClick={clipboard?.onCopy}
            icon={<Copy size={16} aria-hidden />}
          />
        </ToolbarRow>
      </ToolbarGroup>
      <ToolbarGroup label="Font">
        <ToolbarRow>
          <RibbonSelect
            label="Font"
            className="w-[8.5rem]"
            value={format?.fontFamily ?? ''}
            options={[DEFAULT_FONT, ...FONT_FACES]}
            disabled={!editing}
            soon={format?.emphasisUnavailable}
            onChange={(value) =>
              format?.onFontFamily(value === '' ? null : value)
            }
          />
          <RibbonSelect
            label="Font size"
            className="w-12"
            value={
              format?.fontSize === null || format?.fontSize === undefined
                ? ''
                : String(format.fontSize)
            }
            options={[DEFAULT_SIZE, ...FONT_SIZES]}
            disabled={!editing}
            soon={format?.emphasisUnavailable}
            onChange={(value) =>
              format?.onFontSize(value === '' ? null : Number(value))
            }
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
            pressed={format?.strikethrough}
            disabled={!editing}
            soon={format?.emphasisUnavailable}
            onClick={format?.onToggleStrikethrough}
            icon={<TextStrikethrough size={16} aria-hidden />}
          />
          <RibbonSelect
            label="Font colour"
            className="w-20"
            value={format?.colour ?? ''}
            options={[DEFAULT_COLOUR, ...FONT_COLOURS]}
            disabled={!editing}
            soon={format?.emphasisUnavailable}
            onChange={(value) => format?.onColour(value === '' ? null : value)}
          />
          <IconButton
            label="Highlight"
            pressed={Boolean(format?.highlight && format.highlight !== 'none')}
            disabled={!editing}
            soon={format?.emphasisUnavailable}
            onClick={format?.onToggleHighlight}
            icon={<Highlighter size={16} aria-hidden />}
          />
          <IconButton
            label="Superscript"
            pressed={format?.vertAlign === 'superscript'}
            disabled={!editing}
            soon={format?.emphasisUnavailable}
            onClick={format?.onToggleSuperscript}
            icon={<TextSuperscript size={16} aria-hidden />}
          />
          <IconButton
            label="Subscript"
            pressed={format?.vertAlign === 'subscript'}
            disabled={!editing}
            soon={format?.emphasisUnavailable}
            onClick={format?.onToggleSubscript}
            icon={<TextSubscript size={16} aria-hidden />}
          />
          <IconButton
            label="Clear formatting"
            disabled={!editing}
            soon={format?.emphasisUnavailable}
            onClick={format?.onClearFormatting}
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
            pressed={format?.alignment === 'left'}
            disabled={!editing}
            onClick={() => format?.onAlignment('left')}
            icon={<TextAlignLeft size={16} aria-hidden />}
          />
          <IconButton
            label="Align centre"
            pressed={format?.alignment === 'center'}
            disabled={!editing}
            onClick={() => format?.onAlignment('center')}
            icon={<TextAlignCenter size={16} aria-hidden />}
          />
          <IconButton
            label="Align right"
            pressed={format?.alignment === 'right'}
            disabled={!editing}
            onClick={() => format?.onAlignment('right')}
            icon={<TextAlignRight size={16} aria-hidden />}
          />
          <IconButton
            label="Justify"
            pressed={format?.alignment === 'both'}
            disabled={!editing}
            onClick={() => format?.onAlignment('both')}
            icon={<TextAlignJustify size={16} aria-hidden />}
          />
          <RibbonSelect
            label="Line spacing"
            className="w-14"
            value={format?.lineSpacing ?? ''}
            options={LINE_SPACING_OPTIONS}
            disabled={!editing}
            onChange={(value) => format?.onLineSpacing(value)}
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
            disabled={!canEdit || deleteParagraphReason !== undefined}
            disabledReason={deleteParagraphReason}
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
            disabled={!canEdit || !canRedo}
            onClick={onRedo}
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
