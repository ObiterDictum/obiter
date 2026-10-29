import type { SelectionEndpoint } from '../../document-selection'

export type ParagraphSelectionBinding = {
  range: { from: number; to: number } | null
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
  onPasteText?: (text: string, from: number, to: number) => void
  onClear: () => void
  onRejectInput: () => void
  onEscapeBlur: () => void
}

export type ParagraphSelectionHandlers = Omit<
  ParagraphSelectionBinding,
  'range' | 'focus' | 'onPasteText'
> & {
  onPasteText?: (
    paragraphId: string,
    text: string,
    from: number,
    to: number,
  ) => void
}
