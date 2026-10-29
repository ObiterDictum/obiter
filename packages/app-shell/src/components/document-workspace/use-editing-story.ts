import { useRef, useState } from 'react'
import type { DocumentModelWire, DocumentStoryWire } from '@obiter/contracts'
import { documentStory } from '../../document-model-text'
import { editingStoryFor } from '../../document-page-layout'
import {
  clearVerticalColumn,
  type VerticalCaretColumn,
} from './paragraph-arrow'

export type EditingKind = 'document' | 'header' | 'footer' | 'footnotes'

const emptyFootnotesStory: DocumentStoryWire = {
  partName: 'word/footnotes.xml',
  kind: 'footnotes',
  paragraphs: [],
  preservedXmlFragments: [],
  fields: [],
  unanchoredFieldParagraphIds: [],
}

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

  const caretDocument = useRef<string | null>(null)
  if (caretDocument.current !== documentId) {
    caretDocument.current = documentId
    clearVerticalColumn(verticalCaret)
    setEditingKind('document')
  }

  const resolved: DocumentStoryWire | undefined = model
    ? editingStoryFor(model, editingKind)
    : undefined
  const editingStory: DocumentStoryWire | undefined =
    editingKind === 'footnotes'
      ? (resolved ?? emptyFootnotesStory)
      : (resolved ?? (model ? documentStory(model) : undefined))

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
