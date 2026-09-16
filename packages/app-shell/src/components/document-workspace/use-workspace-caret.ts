import { useRef, useState } from 'react'
import type { DocumentModelWire } from '@obiter/contracts'
import { flowParagraphIds } from '../../document-edits'
import { cursorForSelection, documentStory } from '../../document-model-text'
import {
  documentRangeRefusal,
  type DocumentRangeRefusal,
} from '../../document-range-edits'
import { storyBodyParagraphIds } from '../../document-story-flow'
import {
  orderedSelection,
  reconcileSelection,
  selectionCollapsed,
  selectionDirection,
  selectionPlainText,
  selectionSegmentMap,
  wholeDocumentSelection,
  type DocumentSelection,
  type SelectionEndpoint,
  type SelectionOrder,
} from '../../document-selection'
import { blockText, type EditorState } from '../../document-word-edits'
import {
  clearVerticalColumn,
  createVerticalCaretColumn,
  isVerticalDelivery,
} from './paragraph-arrow'
import {
  refusalMessage,
  type SelectionRefusal,
} from './document-selection-notices'
import { useWorkspaceFind } from './use-workspace-find'
import type { useWorkspaceDrafts } from './use-workspace-drafts'

type WorkspaceDrafts = ReturnType<typeof useWorkspaceDrafts>

export type CaretPlacement = { paragraphId: string; offset: number }

/**
 * Owns the workspace caret and the document selection; find/replace state is
 * its own hook. Anchor and focus live here and nowhere else: paragraph
 * components receive the derived per-paragraph segments and the actions they
 * need, never their own copy. The vertical-caret holder lives here too so a
 * column run survives the paragraph remount a vertical move causes, and so
 * switching documents in the reused workspace clears it.
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
  const [selection, setSelection] = useState<DocumentSelection | null>(null)
  const [selectionRefusal, setSelectionRefusal] =
    useState<SelectionRefusal | null>(null)
  const [verticalCaret] = useState(createVerticalCaretColumn)
  // Find owns its own query, hit set and navigation; it places the caret
  // through the same explicit placement the rest of the workspace uses.
  const find = useWorkspaceFind({
    model,
    drafts,
    onPlaceCaret: selectParagraph,
  })

  // A column run never spans documents, and this workspace is reused when the
  // selected document changes.
  const caretDocument = useRef<string | null>(null)
  if (caretDocument.current !== documentId) {
    caretDocument.current = documentId
    clearVerticalColumn(verticalCaret)
  }

  const state: EditorState | null = model
    ? {
        drafts: drafts.drafts,
        inserts: drafts.inserts,
        deletedParagraphIds: drafts.deletedParagraphIds,
        extraRuns: drafts.extraRuns,
      }
    : null
  const order = model
    ? flowParagraphIds(model, drafts.inserts, drafts.deletedParagraphIds)
    : []
  const context: SelectionOrder = {
    order,
    textOf: (paragraphId) =>
      model && state ? blockText(model, state, paragraphId) : '',
  }
  const insertIds = new Set(drafts.inserts.map((item) => item.clientId))
  // The paragraphs the flow renders as ordinary body text. A table cell or a
  // text-box paragraph is not one, so the selection stops at it rather than
  // covering content the document selection cannot paint or edit.
  const story = model ? documentStory(model) : undefined
  const bodyIds = story ? storyBodyParagraphIds(story) : new Set<string>()
  const structuralIds = new Set(
    order.filter((id) => !bodyIds.has(id) && !insertIds.has(id)),
  )
  // Derived, never an effect: a paragraph that no longer exists (deleted, or a
  // reload that replaced the ids) drops the selection and an offset past the
  // paragraph's text clamps, so nothing stale is ever acted on.
  const resolvedSelection = reconcileSelection(context, selection)
  const segments = resolvedSelection
    ? selectionSegmentMap(context, resolvedSelection)
    : new Map()
  // A selection that covers no text at all (only a paragraph break) still
  // exists for the editor, but nothing paints for it and the plain arrows
  // collapse it like any other.
  const selectionActive =
    resolvedSelection !== null && !selectionCollapsed(resolvedSelection)
  const selectionNotice = refusalMessage(
    selectionRefusal,
    insertIds.size > 0,
    structuralIds.size > 0,
  )

  function clearSelectionState() {
    setSelection(null)
    setSelectionRefusal(null)
  }

  /** A pointer press ends a document selection, the way it collapses a
   * native one: the range the pointer then drags is mirrored as it changes. */
  function clearSelection() {
    clearSelectionState()
  }

  function mirrorSelection(
    paragraphId: string,
    from: number,
    to: number,
    direction: 'forward' | 'backward',
  ) {
    // A document selection is the authority for its own ranges; the DOM range
    // is only that selection's intersection with the focused paragraph. Only a
    // native selection made with a live, non-collapsed document selection
    // absent is mirrored: a selection shrunk back onto its anchor is gone as
    // far as the caret is concerned, and a structural paragraph is not
    // selectable content.
    if (from === to) return
    if (resolvedSelection && !selectionCollapsed(resolvedSelection)) return
    if (insertIds.has(paragraphId) || structuralIds.has(paragraphId)) return
    // The textarea keeps the anchor at the end a shift-move did not touch, so
    // a backward native selection anchors at its higher offset.
    const anchor = direction === 'backward' ? to : from
    const focus = direction === 'backward' ? from : to
    setSelection({
      anchor: { paragraphId, offset: anchor },
      focus: { paragraphId, offset: focus },
    })
    // Every selection path keeps the workspace caret at the moving end, so an
    // extension can read the focus without asking the DOM which end it is.
    setSelectedParagraphId(paragraphId)
    setRestoreCaret({ paragraphId, offset: focus })
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
    // An explicit caret placement replaces the selection.
    setSelection(null)
    setSelectionRefusal(null)
    setSelectedParagraphId(paragraphId)
    setRestoreCaret(offset == null ? null : { paragraphId, offset })
    if (offset != null) setFormatRange({ from: offset, to: offset })
  }

  /**
   * Focus without moving the caret. A paragraph editor that takes focus as part
   * of an existing selection must not be mistaken for a request to place the
   * caret, which would drop the selection being extended.
   */
  function focusParagraph(paragraphId: string) {
    setSelectedParagraphId(paragraphId)
  }

  function extendSelection(
    focus: SelectionEndpoint,
    anchor: SelectionEndpoint,
  ) {
    if (insertIds.has(focus.paragraphId)) {
      setSelectionRefusal('insert')
      return
    }
    if (structuralIds.has(focus.paragraphId)) {
      setSelectionRefusal('structure')
      return
    }
    // A selection shrunk back onto its anchor is collapsed, not alive: the
    // next extension must anchor where the caret actually is, not at the
    // obsolete anchor this selection was built from.
    const base =
      resolvedSelection && !selectionCollapsed(resolvedSelection)
        ? resolvedSelection
        : null
    if (
      !isVerticalDelivery(verticalCaret, {
        paragraphId: focus.paragraphId,
        offset: focus.offset,
      })
    ) {
      clearVerticalColumn(verticalCaret)
    }
    setSelection(base ? { anchor: base.anchor, focus } : { anchor, focus })
    setSelectionRefusal(null)
    setSelectedParagraphId(focus.paragraphId)
    setRestoreCaret({ paragraphId: focus.paragraphId, offset: focus.offset })
  }

  function collapseSelection(edge: 'start' | 'end' | 'focus') {
    if (!resolvedSelection) return
    const { start, end } = orderedSelection(order, resolvedSelection)
    const at =
      edge === 'focus'
        ? resolvedSelection.focus
        : edge === 'start'
          ? start
          : end
    clearVerticalColumn(verticalCaret)
    setSelection(null)
    setSelectionRefusal(null)
    setSelectedParagraphId(at.paragraphId)
    setRestoreCaret({ paragraphId: at.paragraphId, offset: at.offset })
    setFormatRange({ from: at.offset, to: at.offset })
  }

  function selectAll() {
    if (order.some((id) => insertIds.has(id))) {
      setSelectionRefusal('insert')
      return
    }
    // Selecting the whole body would bridge every structural paragraph in it,
    // so it is refused the same way an unsaved insert is.
    if (order.some((id) => structuralIds.has(id))) {
      setSelectionRefusal('structure')
      return
    }
    const next = wholeDocumentSelection(context)
    if (!next) return
    clearVerticalColumn(verticalCaret)
    setSelection(next)
    setSelectionRefusal(null)
    setSelectedParagraphId(next.focus.paragraphId)
    setRestoreCaret({
      paragraphId: next.focus.paragraphId,
      offset: next.focus.offset,
    })
  }

  /** The ordered endpoints of the live selection, for a range operation. */
  function selectedRange(): {
    start: SelectionEndpoint
    end: SelectionEndpoint
  } | null {
    if (!resolvedSelection || selectionCollapsed(resolvedSelection)) {
      return null
    }
    const range = orderedSelection(order, resolvedSelection)
    const from = order.indexOf(range.start.paragraphId)
    const to = order.indexOf(range.end.paragraphId)
    for (let index = from; index <= to; index += 1) {
      const id = order[index]
      if (id !== undefined && insertIds.has(id)) {
        setSelectionRefusal('insert')
        return null
      }
    }
    if (model && state) {
      const refusal = documentRangeRefusal(model, state, range.start, range.end)
      if (refusal) {
        setSelectionRefusal(refusal)
        return null
      }
    }
    return range
  }

  function replaceSelectionRange(text: string) {
    const range = selectedRange()
    if (!model || !range) return
    const caret = drafts.replaceDocumentRange(
      model,
      range.start,
      range.end,
      text,
    )
    if (caret) selectParagraph(caret.paragraphId, caret.offset)
  }

  /** A plain-arrow crossing into a structural paragraph stops: the flow the
   * selection covers is the body text, and a table cell is not part of it. */
  function moveCaret(paragraphId: string, offset: number) {
    if (structuralIds.has(paragraphId)) return
    selectParagraph(paragraphId, offset)
  }

  /** Input that reached the editor but cannot replace the range. Fail closed
   * with a reason rather than letting the field silently revert. */
  function rejectSelectionInput() {
    setSelectionRefusal('input')
  }

  /** A single-caret delete could not join its neighbour. Say why in the same
   * live region the selection refusals use, so a refused table-boundary join
   * is announced rather than silent. */
  function reportJoinRefusal(refusal: DocumentRangeRefusal) {
    setSelectionRefusal(refusal)
  }

  /** Escape with no live selection: leave the paragraph. Drafts are separate
   * from the caret, so nothing unsaved is discarded. */
  function blurParagraph() {
    setSelection(null)
    setSelectionRefusal(null)
    setSelectedParagraphId(null)
  }

  function splitSelectionRange() {
    const range = selectedRange()
    if (!model || !range) return
    const caret = drafts.splitDocumentRange(model, range.start, range.end)
    if (caret) selectParagraph(caret.paragraphId, caret.offset)
  }

  function copySelection(clipboard: DataTransfer | null) {
    if (!resolvedSelection) return
    clipboard?.setData(
      'text/plain',
      selectionPlainText(context, resolvedSelection),
    )
  }

  function cutSelection(clipboard: DataTransfer | null) {
    // Validate the range before the clipboard is touched, so a refused edit
    // cannot leave text in the clipboard that was never removed. The deletion
    // then runs through the same path validated here.
    const range = selectedRange()
    if (!range || !resolvedSelection || !model) return
    if (!clipboard) {
      setSelectionRefusal('clipboard')
      return
    }
    try {
      clipboard.setData(
        'text/plain',
        selectionPlainText(context, resolvedSelection),
      )
    } catch {
      setSelectionRefusal('clipboard')
      return
    }
    replaceSelectionRange('')
  }

  function setFindQuery(query: string) {
    find.setFindQuery(query)
  }

  const findHits = find.findHits
  const activeFindIndex = find.activeFindIndex

  function insertAuthority(citation: string) {
    if (!model) return
    const paragraphId =
      selectedParagraphId ?? documentStory(model)?.paragraphs[0]?.id
    if (!paragraphId) return
    const offset =
      restoreCaret?.paragraphId === paragraphId
        ? restoreCaret.offset
        : blockText(model, state ?? emptyState, paragraphId).length
    const caret = drafts.insertText(model, paragraphId, offset, citation)
    if (caret) selectParagraph(caret.paragraphId, caret.offset)
  }

  function undoDocument() {
    const beforeInserts = drafts.inserts
    const restored = drafts.undoDraft()
    if (!restored || !model) return
    setSelection(null)
    setSelectionRefusal(null)
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
      blockText(
        model,
        {
          drafts: restored.drafts,
          inserts: restored.inserts,
          deletedParagraphIds: restored.deletedParagraphIds,
          extraRuns: restored.extraRuns,
        },
        removed.afterParagraphId,
      ).length,
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
    selection: resolvedSelection,
    selectionActive,
    selectionDirection: resolvedSelection
      ? selectionDirection(order, resolvedSelection)
      : 'none',
    selectionSegments: segments,
    clearSelection,
    mirrorSelection,
    moveCaret,
    rejectSelectionInput,
    reportJoinRefusal,
    blurParagraph,
    // Derived from the refusal and the condition that produced it, so the
    // message cannot outlive the reason it was shown for.
    selectionNotice,
    selectAll,
    extendSelection,
    collapseSelection,
    focusParagraph,
    replaceSelectionRange,
    splitSelectionRange,
    copySelection,
    cutSelection,
    findQuery: find.findQuery,
    setFindQuery,
    replaceQuery: find.replaceQuery,
    setReplaceQuery: find.setReplaceQuery,
    findHits,
    activeFindIndex,
    selectParagraph,
    onNextHit: find.onNextHit,
    onPreviousHit: find.onPreviousHit,
    onReplaceOne: find.onReplaceOne,
    onReplaceAll: find.onReplaceAll,
    insertAuthority,
    undoDocument,
  }
}

const emptyState: EditorState = {
  drafts: {},
  inserts: [],
  deletedParagraphIds: [],
  extraRuns: {},
}
