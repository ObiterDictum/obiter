import {
  ArrowClockwise,
  ArrowCounterClockwise,
  Command,
  ListBullets,
  ListNumbers,
  TextAlignCenter,
  TextAlignJustify,
  TextAlignLeft,
  TextAlignRight,
  TextB,
  TextItalic,
  TextUnderline,
  TextAa,
} from '@phosphor-icons/react'
import {
  EditorIconButton,
  EditorSelect,
  EditorTextButton,
} from './editor-controls'
import type { EditorChromeProps } from './editor-commands'
import { styleDisplayName } from './editor-commands'

/** The value the style select shows when the selection covers several styles. */
const MIXED_STYLE_VALUE = '__mixed__'

/**
 * The one compact toolbar row: the controls a document is actually written
 * with. Everything else lives in the menu bar and the command palette, so the
 * page gets the vertical space back. The row never wraps; a narrow window
 * scrolls it sideways rather than pushing the paper down.
 */
export function EditorToolbar({
  props,
  onOpenFormatting,
  onOpenPalette,
}: {
  props: EditorChromeProps
  onOpenFormatting: () => void
  onOpenPalette: () => void
}) {
  const { format } = props
  const editing = props.canEdit && Boolean(format)
  const styles = format?.paragraphStyles ?? []
  const mixed = Boolean(format?.paragraphStyleMixed)
  return (
    <div
      data-editor-toolbar
      className="flex min-w-0 items-center gap-1 overflow-x-auto border-b border-line px-3 py-1"
      role="toolbar"
      aria-label="Document toolbar"
    >
      <EditorIconButton
        label="Undo"
        disabled={!props.canEdit || !props.canUndo}
        onClick={props.onUndo}
        icon={<ArrowCounterClockwise size={16} aria-hidden />}
      />
      <EditorIconButton
        label="Redo"
        disabled={!props.canEdit || !props.canRedo}
        onClick={props.onRedo}
        icon={<ArrowClockwise size={16} aria-hidden />}
      />
      <ToolbarDivider />
      {format ? (
        <EditorSelect
          label="Paragraph style"
          className="w-34"
          value={mixed ? MIXED_STYLE_VALUE : format.paragraphStyleId}
          options={[
            ...(mixed
              ? [{ value: MIXED_STYLE_VALUE, label: 'Mixed styles' }]
              : []),
            { value: '', label: 'No direct style' },
            ...styles.map((style) => ({
              value: style.styleId,
              label: styleDisplayName(style.name, style.styleId),
            })),
          ]}
          disabled={styles.length === 0}
          disabledReason="This document has no paragraph styles."
          onChange={(value) => {
            if (value === MIXED_STYLE_VALUE) return
            format.onParagraphStyle(value === '' ? null : value)
          }}
        />
      ) : null}
      <ToolbarDivider />
      <EditorIconButton
        label="Bold"
        pressed={format?.bold}
        disabled={!editing || Boolean(format?.emphasisUnavailable)}
        disabledReason={format?.emphasisUnavailable}
        onClick={format?.onToggleBold}
        icon={<TextB size={16} aria-hidden />}
      />
      <EditorIconButton
        label="Italic"
        pressed={format?.italic}
        disabled={!editing || Boolean(format?.emphasisUnavailable)}
        disabledReason={format?.emphasisUnavailable}
        onClick={format?.onToggleItalic}
        icon={<TextItalic size={16} aria-hidden />}
      />
      <EditorIconButton
        label="Underline"
        pressed={format?.underline}
        disabled={!editing || Boolean(format?.emphasisUnavailable)}
        disabledReason={format?.emphasisUnavailable}
        onClick={format?.onToggleUnderline}
        icon={<TextUnderline size={16} aria-hidden />}
      />
      <ToolbarDivider />
      <EditorIconButton
        label="Bullets"
        pressed={format?.listKind === 'bullet'}
        disabled={!editing || !format?.canApplyBullet}
        onClick={() => format?.onToggleList('bullet')}
        icon={<ListBullets size={16} aria-hidden />}
      />
      <EditorIconButton
        label="Numbering"
        pressed={format?.listKind === 'number'}
        disabled={!editing || !format?.canApplyNumber}
        onClick={() => format?.onToggleList('number')}
        icon={<ListNumbers size={16} aria-hidden />}
      />
      <ToolbarDivider />
      <EditorIconButton
        label="Align left"
        pressed={format?.alignment === 'left'}
        disabled={!editing}
        onClick={() => format?.onAlignment('left')}
        icon={<TextAlignLeft size={16} aria-hidden />}
      />
      <EditorIconButton
        label="Align centre"
        pressed={format?.alignment === 'center'}
        disabled={!editing}
        onClick={() => format?.onAlignment('center')}
        icon={<TextAlignCenter size={16} aria-hidden />}
      />
      <EditorIconButton
        label="Align right"
        pressed={format?.alignment === 'right'}
        disabled={!editing}
        onClick={() => format?.onAlignment('right')}
        icon={<TextAlignRight size={16} aria-hidden />}
      />
      <EditorIconButton
        label="Justify"
        pressed={format?.alignment === 'both'}
        disabled={!editing}
        onClick={() => format?.onAlignment('both')}
        icon={<TextAlignJustify size={16} aria-hidden />}
      />
      <ToolbarDivider />
      <EditorTextButton
        label={
          props.commentCount > 0
            ? `Comments (${String(props.commentCount)})`
            : 'Comments'
        }
        pressed={props.commentsOpen}
        onClick={props.onToggleComments}
      />
      <div className="ms-auto flex shrink-0 items-center gap-1">
        <EditorIconButton
          label="Font, paragraph and page"
          disabled={!editing}
          disabledReason="Requires an editable document."
          onClick={onOpenFormatting}
          icon={<TextAa size={16} aria-hidden />}
        />
        <EditorIconButton
          label="All commands"
          hint="Ctrl K"
          onClick={onOpenPalette}
          icon={<Command size={16} aria-hidden />}
        />
      </div>
    </div>
  )
}

function ToolbarDivider() {
  return <div className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />
}
