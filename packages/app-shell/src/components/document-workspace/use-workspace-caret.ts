import { useRef, useState } from 'react'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  clampFindIndex,
  findInDocument,
  nextFindIndex,
  previousFindIndex,
} from '../../document-find'
import { cursorForSelection, documentStory } from '../../document-model-text'
import { blockText } from '../../document-word-edits'
import {
  clearVerticalColumn,
  createVerticalCaretColumn,
  isVerticalDelivery,
} from './paragraph-arrow'
import type { useWorkspaceDrafts } from './use-workspace-drafts'

type WorkspaceDrafts = ReturnType<typeof useWorkspaceDrafts>

export type CaretPlacement = { paragraphId: string; offset: number }

/**
 * Owns the workspace caret, selection and find state. The vertical-caret holder
 * lives here so a column run survives the paragraph-editor remount a vertical
 * move causes, and so switching documents in the reused workspace clears it.
 */
export function useWorkspaceCaret({
  documentId,
  model,
  drafts,
}: {
  documentId: string
  model: DocumentModelWire | undefined
  drafts: WorkspaceDrafts
}) {
  const [selectedParagraphId, setSelectedParagraphId] = useState<string | null>(
    null,
  )
  const [restoreCaret, setRestoreCaret] = useState<CaretPlacement | null>(null)
  const [formatRange, setFormatRange] = useState<{
    from: number
    to: number
  } | null>(null)
  const [verticalCaret] = useState(createVerticalCaretColumn)
  const [findQuery, setFindQueryState] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [findIndex, setFindIndex] = useState(-1)

  // A column run never spans documents, and this workspace is reused when the
  // selected document changes.
  const caretDocument = useRef<string | null>(null)
  if (caretDocument.current !== documentId) {
    caretDocument.current = documentId
    clearVerticalColumn(verticalCaret)
  }

  function selectParagraph(paragraphId: string, offset?: number) {
    // A vertical move arms the delivery for its own destination just before it
    // moves, so only that exact transition keeps the run's column; any other
    // offset placement ends it.
    if (
      offset != null &&
      !isVerticalDelivery(verticalCaret, { paragraphId, offset })
    ) {
      clearVerticalColumn(verticalCaret)
    }
    setSelectedParagraphId(paragraphId)
    setRestoreCaret(offset == null ? null : { paragraphId, offset })
    if (offset != null) setFormatRange({ from: offset, to: offset })
  }

  function setFindQuery(query: string) {
    setFindQueryState(query)
    setFindIndex(-1)
  }

  const findHits = model
    ? findInDocument(
        model,
        drafts.drafts,
        drafts.inserts,
        drafts.deletedParagraphIds,
        drafts.extraRuns,
        findQuery,
      )
    : []
  // Clamp the stored index to the current hit set so edits that shrink the
  // hits cannot leave the label or navigation on a stale position.
  const activeFindIndex = clampFindIndex(findIndex, findHits.length)

  function jumpToHit(index: number) {
    const hit = findHits[index]
    if (!hit) return
    setFindIndex(index)
    selectParagraph(hit.paragraphId, hit.start)
  }

  function replaceCurrentHit() {
    if (!model || findHits.length === 0) return
    const index = activeFindIndex < 0 ? 0 : activeFindIndex
    const caret = drafts.replaceHits(model, findHits, replaceQuery, index)
    if (caret) selectParagraph(caret.paragraphId, caret.offset)
  }

  function replaceAllHits() {
    if (!model || findHits.length === 0) return
    const caret = drafts.replaceHits(model, findHits, replaceQuery, 'all')
    if (caret) selectParagraph(caret.paragraphId, caret.offset)
  }

  function insertAuthority(citation: string) {
    if (!model) return
    const paragraphId =
      selectedParagraphId ?? documentStory(model)?.paragraphs[0]?.id
    if (!paragraphId) return
    const offset =
      restoreCaret?.paragraphId === paragraphId
        ? restoreCaret.offset
        : blockText(
            model,
            {
              drafts: drafts.drafts,
              inserts: drafts.inserts,
              deletedParagraphIds: drafts.deletedParagraphIds,
              extraRuns: drafts.extraRuns,
            },
            paragraphId,
          ).length
    const caret = drafts.insertText(model, paragraphId, offset, citation)
    if (caret) selectParagraph(caret.paragraphId, caret.offset)
  }

  function undoDocument() {
    const beforeInserts = drafts.inserts
    const restored = drafts.undoDraft()
    if (!restored || !model) return
    // Undoing a split/insert removes the paragraph the caret was on. Move
    // selection back to the paragraph the removed insert was anchored after
    // so the user is not left with nothing selected.
    const target = restoreCaret?.paragraphId ?? selectedParagraphId
    if (!target) return
    const removed = beforeInserts.find((item) => item.clientId === target)
    // Only redirect when the insert the caret was on is actually gone after
    // the undo. An insert that survived (e.g. undoing a text edit inside
    // it) must keep the caret; the editor clamps the offset to its text.
    if (!removed || restored.inserts.some((item) => item.clientId === target)) {
      return
    }
    selectParagraph(
      removed.afterParagraphId,
      blockText(model, restored, removed.afterParagraphId).length,
    )
  }

  const cursor =
    selectedParagraphId && model
      ? cursorForSelection(model, selectedParagraphId)
      : null

  return {
    selectedParagraphId,
    restoreCaret,
    formatRange,
    setFormatRange,
    verticalCaret,
    cursor,
    findQuery,
    setFindQuery,
    replaceQuery,
    setReplaceQuery,
    findHits,
    activeFindIndex,
    selectParagraph,
    onNextHit: () => jumpToHit(nextFindIndex(findHits, activeFindIndex)),
    onPreviousHit: () =>
      jumpToHit(previousFindIndex(findHits, activeFindIndex)),
    onReplaceOne: replaceCurrentHit,
    onReplaceAll: replaceAllHits,
    insertAuthority,
    undoDocument,
  }
}
