import type { SelectionEndpoint } from '../../document-selection'

/**
 * What the editor needs to take part in a document selection. `range` is the
 * selection's slice of this textarea, in this editor's local offsets; `active`
 * says a non-collapsed document selection exists, which is when the editor owns
 * Shift+Arrow and the edit keys instead of leaving them to the textarea.
 */
export type ParagraphSelectionBinding = {
  range: { from: number; to: number } | null
  /**
   * Slice-local offset of the moving end. The model owns it, so an extension
   * never has to guess from a DOM range whose direction a programmatic write
   * has already reset.
   */
  focus: number | null
  direction: 'forward' | 'backward' | 'none'
  active: boolean
  onExtend: (focus: SelectionEndpoint, anchor: SelectionEndpoint) => void
  onCollapse: (edge: 'start' | 'end' | 'focus') => void
  onSelectAll: () => void
  onReplaceRange: (text: string) => void
  onDeleteRange: () => void
  onSplitRange: () => void
  onCopyRange: (clipboard: DataTransfer | null) => void
  onCutRange: (clipboard: DataTransfer | null) => void
  onClear: () => void
  /** Input the editor cannot express as a document-range replacement. */
  onRejectInput: () => void
  /** Escape with no live selection leaves the paragraph. */
  onEscapeBlur: () => void
}

export type ParagraphSelectionHandlers = Omit<
  ParagraphSelectionBinding,
  'range' | 'focus'
>
