import { useMemo, useState } from 'react'
import type { DocumentModelWire } from '@obiter/contracts'
import { useCommentAnchors } from './comment-target'
import { storyFlowParagraphIds } from '../../document-edits'
import { cursorForSelection } from '../../document-model-text'
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
import { useWorkspaceClipboard } from './use-workspace-clipboard'
import { useEditingStory } from './use-editing-story'
import { useHistoryCaret } from './use-history-caret'
import { useCaretLineageRemap } from './caret-lineage'
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
  // The story the caret belongs to — the body, or the final section's
  // header/footer while one is open.
  const { editingKind, editingStory, openEditingStory, closeEditingStory } =
    useEditingStory({
      documentId,
      model,
      verticalCaret,
      setSelection,
      setSelectionRefusal,
      setSelectedParagraphId,
      setRestoreCaret,
      setFormatRange,
    })
  useCaretLineageRemap({
    paragraphRemap: drafts.paragraphRemap,
    setSelectedParagraphId,
    setRestoreCaret,
    setSelection,
  })
  // Find owns its own query, hit set and navigation; it places the caret
  // through the same explicit placement the rest of the workspace uses.
  const find = useWorkspaceFind({
    model,
    drafts,
    onPlaceCaret: selectParagraph,
    story: editingStory,
  })

  const state: EditorState | null = model
    ? {
        drafts: drafts.drafts,
        inserts: drafts.inserts,
        deletedParagraphIds: drafts.deletedParagraphIds,
        extraRuns: drafts.extraRuns,
      }
    : null
  const order = storyFlowParagraphIds(
    editingStory,
    drafts.inserts,
    drafts.deletedParagraphIds,
  )
  const context: SelectionOrder = {
    order,
    textOf: (paragraphId) =>
      model && state ? blockText(model, state, paragraphId) : '',
  }
  const insertIds = new Set(drafts.inserts.map((item) => item.clientId))
  // The paragraphs the flow renders as ordinary body text. A table cell or a
  // text-box paragraph is not one, so the selection stops at it rather than
  // covering content the document selection cannot paint or edit.
  const story = editingStory
  // The body/structure partition walks every table in the story and is a pure
  // function of the model, so it is derived once rather than on each render.
  const bodyIds = useMemo(
    () => (story ? storyBodyParagraphIds(story) : new Set<string>()),
    [story],
  )
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
  const clipboard = useWorkspaceClipboard({
    model,
    selection: resolvedSelection,
    selectionActive,
    context,
    selectedRange,
    replaceSelection: replaceSelectionRange,
    selectedParagraphId,
    selectionParagraphIds: new Set(segments.keys()),
    isStructuralParagraph: (paragraphId) => structuralIds.has(paragraphId),
    formatRange,
    restoreCaret,
    placeCaret: selectParagraph,
    setRefusal: setSelectionRefusal,
    paste: drafts.paste,
    firstParagraphId: editingStory?.paragraphs[0]?.id,
  })

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
    // A reseat without an offset is a focus, not a caret, so the previous
    // paragraph's format range must not survive as a phantom selection.
    setFormatRange(offset == null ? null : { from: offset, to: offset })
  }

  /**
   * Focus without moving the caret. A paragraph editor that takes focus as part
   * of an existing selection must not be mistaken for a request to place the
   * caret, which would drop the selection being extended. A focus on a
   * different paragraph also ends any format range, so a later break insert
   * cannot address a stale offset. A focus that re-enters the paragraph already
   * holding the caret keeps its resolved range: pagination remounts the editor
   * after a page break, and dropping the range there would send the next break
   * to offset zero.
   */
  function focusParagraph(paragraphId: string) {
    setSelectedParagraphId(paragraphId)
    setFormatRange((current) =>
      selectedParagraphId === paragraphId ? current : null,
    )
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

  function replaceSelectionRange(
    text: string,
    range?: { start: SelectionEndpoint; end: SelectionEndpoint },
  ) {
    const resolved = range ?? selectedRange()
    if (!model || !resolved) return
    const caret = drafts.replaceDocumentRange(
      model,
      resolved.start,
      resolved.end,
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

  /** Escape with no live selection: leave the paragraph, and leave an open
   * margin story with it. Drafts are separate from the caret, so nothing
   * unsaved is discarded. */
  const blurParagraph = closeEditingStory

  function splitSelectionRange() {
    const range = selectedRange()
    if (!model || !range) return
    const caret = drafts.splitDocumentRange(model, range.start, range.end)
    if (caret) selectParagraph(caret.paragraphId, caret.offset)
  }

  function setFindQuery(query: string) {
    find.setFindQuery(query)
  }

  const findHits = find.findHits
  const activeFindIndex = find.activeFindIndex

  function insertAuthority(citation: string, italic: boolean) {
    if (!model) return
    const paragraphId = selectedParagraphId ?? editingStory?.paragraphs[0]?.id
    if (!paragraphId) return
    const offset =
      restoreCaret?.paragraphId === paragraphId
        ? restoreCaret.offset
        : blockText(model, state ?? emptyState, paragraphId).length
    // The citation style only shapes what is written now — the house style's
    // italic is a formatting draft over the inserted range in the same
    // history step, so undo removes text and styling together.
    const caret = italic
      ? drafts.insertStyledText(model, paragraphId, offset, citation, {
          italic: true,
        })
      : drafts.insertText(model, paragraphId, offset, citation)
    if (caret) selectParagraph(caret.paragraphId, caret.offset)
  }

  const { undoDocument, redoDocument } = useHistoryCaret({
    model,
    drafts,
    restoreCaret,
    selectedParagraphId,
    onPlaceCaret: selectParagraph,
    onClearSelection: clearSelectionState,
  })

  const cursor =
    selectedParagraphId && model
      ? cursorForSelection(model, selectedParagraphId)
      : null

  const { commentTarget, revealCommentAnchor } = useCommentAnchors({
    order,
    selection: resolvedSelection,
    selectedParagraphId,
    formatRange,
    actions: { closeEditingStory, selectParagraph, extendSelection },
  })

  return {
    selectedParagraphId,
    restoreCaret,
    formatRange,
    setFormatRange,
    verticalCaret,
    cursor,
    /** The story kind the caret is editing: the body or an open margin. */
    editingKind,
    /** The story `order` and the editable band resolve from. */
    editingStory,
    openEditingStory,
    closeEditingStory,
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
    commentTarget,
    revealCommentAnchor,
    collapseSelection,
    focusParagraph,
    replaceSelectionRange,
    splitSelectionRange,
    ...clipboard,
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
    redoDocument,
  }
}

const emptyState: EditorState = {
  drafts: {},
  inserts: [],
  deletedParagraphIds: [],
  extraRuns: {},
}
