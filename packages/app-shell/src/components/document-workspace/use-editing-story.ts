import { useState } from 'react'
import type { DocumentModelWire, DocumentStoryWire } from '@obiter/contracts'
import { documentStory } from '../../document-model-text'
import { editingStoryFor } from '../../document-page-layout'
import {
  clearVerticalColumn,
  type VerticalCaretColumn,
} from './paragraph-arrow'

/** The story the caret edits: the body or an open margin. */
export type EditingKind = 'document' | 'header' | 'footer'

/**
 * Owns the editing-story state for the workspace. The kind is the state; the
 * story itself is resolved against the current model so a reload retargets it
 * rather than stranding the editor on a stale part. While a kind is open the
 * body is inert and every edit acts on the resolved story; closing returns
 * the caret to the body with nothing selected.
 */
export function useEditingStory({
  model,
  verticalCaret,
  setSelection,
  setSelectionRefusal,
  setSelectedParagraphId,
  setRestoreCaret,
  setFormatRange,
}: {
  model: DocumentModelWire | undefined
  verticalCaret: VerticalCaretColumn
  setSelection: (selection: null) => void
  setSelectionRefusal: (refusal: null) => void
  setSelectedParagraphId: (paragraphId: string | null) => void
  setRestoreCaret: (
    caret: { paragraphId: string; offset: number } | null,
  ) => void
  setFormatRange: (range: { from: number; to: number } | null) => void
}) {
  const [editingKind, setEditingKind] = useState<EditingKind>('document')

  // A margin kind with no story resolves to the body, so a reload that drops
  // the part lands the editor back in the document rather than stranding it.
  const editingStory: DocumentStoryWire | undefined = model
    ? (editingStoryFor(model, editingKind) ?? documentStory(model))
    : undefined

  /**
   * Opens the final section's header or footer for editing: the caret moves
   * into its first paragraph and the body is inert until the story closes.
   * The ribbon is the only caller and only offers kinds a story exists for.
   */
  function openEditingStory(kind: 'header' | 'footer') {
    setSelection(null)
    setSelectionRefusal(null)
    clearVerticalColumn(verticalCaret)
    setEditingKind(kind)
    const story = model ? editingStoryFor(model, kind) : undefined
    const first = story?.paragraphs[0]
    setSelectedParagraphId(first?.id ?? null)
    setRestoreCaret(first ? { paragraphId: first.id, offset: 0 } : null)
    setFormatRange(first ? { from: 0, to: 0 } : null)
  }

  /** Returns the caret to the body, closing an open header or footer. */
  function closeEditingStory() {
    if (editingKind !== 'document') setEditingKind('document')
    setSelection(null)
    setSelectionRefusal(null)
    setSelectedParagraphId(null)
    setRestoreCaret(null)
    setFormatRange(null)
  }

  return {
    editingKind,
    editingStory,
    openEditingStory,
    closeEditingStory,
    /** The document switch reset: an open story never spans documents. */
    resetEditingStory: () => setEditingKind('document'),
  }
}
