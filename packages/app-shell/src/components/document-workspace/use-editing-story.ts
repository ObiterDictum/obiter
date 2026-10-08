import { useRef, useState } from 'react'
import type { DocumentModelWire, DocumentStoryWire } from '@obiter/contracts'
import { documentStory } from '../../document-model-text'
import { editingStoryFor } from '../../document-page-layout'
import {
  clearVerticalColumn,
  type VerticalCaretColumn,
} from './paragraph-arrow'

/** The story the caret edits: the body, an open margin, or the notes. */
export type EditingKind = 'document' | 'header' | 'footer' | 'footnotes'

/**
 * The stand-in story for an open footnotes kind whose part exists only in
 * the painted model: no paragraphs, so flow-order derivations keep no order
 * instead of addressing the body the user is not editing.
 */
const emptyFootnotesStory: DocumentStoryWire = {
  partName: 'word/footnotes.xml',
  kind: 'footnotes',
  paragraphs: [],
  preservedXmlFragments: [],
}

/**
 * Owns the editing-story state for the workspace. The kind is the state; the
 * story itself is resolved against the current model so a reload retargets it
 * rather than stranding the editor on a stale part. While a kind is open the
 * body is inert and every edit acts on the resolved story; closing returns
 * the caret to the body with nothing selected.
 */
export function useEditingStory({
  documentId,
  model,
  verticalCaret,
  setSelection,
  setSelectionRefusal,
  setSelectedParagraphId,
  setRestoreCaret,
  setFormatRange,
}: {
  documentId: string
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

  // A column run never spans documents, and this workspace is reused when the
  // selected document changes. Neither does an open margin story.
  const caretDocument = useRef<string | null>(null)
  if (caretDocument.current !== documentId) {
    caretDocument.current = documentId
    clearVerticalColumn(verticalCaret)
    setEditingKind('document')
  }

  // A margin kind with no story resolves to the body, so a reload that drops
  // the part lands the editor back in the document rather than stranding it.
  // The footnotes kind cannot use that fallback — its story may exist only in
  // the painted model a pending entry folds in — so an absent part resolves
  // to an empty story that keeps no order rather than the body's.
  const resolved: DocumentStoryWire | undefined = model
    ? editingStoryFor(model, editingKind)
    : undefined
  const editingStory: DocumentStoryWire | undefined =
    editingKind === 'footnotes'
      ? (resolved ?? emptyFootnotesStory)
      : (resolved ?? (model ? documentStory(model) : undefined))

  /**
   * Opens the final section's header or footer — or the footnotes story —
   * for editing: the caret moves into `selectId` when the caller names a
   * paragraph (a freshly folded note body), else the story's first, and the
   * body is inert until the story closes.
   */
  function openEditingStory(
    kind: 'header' | 'footer' | 'footnotes',
    selectId?: string,
    offset = 0,
  ) {
    setSelection(null)
    setSelectionRefusal(null)
    clearVerticalColumn(verticalCaret)
    setEditingKind(kind)
    const story = model ? editingStoryFor(model, kind) : undefined
    const first =
      (selectId
        ? story?.paragraphs.find((item) => item.id === selectId)
        : undefined) ?? story?.paragraphs[0]
    const target = selectId ?? first?.id
    setSelectedParagraphId(target ?? null)
    setRestoreCaret(target ? { paragraphId: target, offset } : null)
    setFormatRange(target ? { from: offset, to: offset } : null)
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
  }
}
