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
import {
  blockText,
  emptyEditorState,
  type EditorState,
} from '../../document-word-edits'
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
  const find = useWorkspaceFind({
    model,
    drafts,
    onPlaceCaret: selectParagraph,
    onRefused: setSelectionRefusal,
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
  const story = editingStory
  const bodyIds = useMemo(
    () => (story ? storyBodyParagraphIds(story) : new Set<string>()),
    [story],
  )
  const structuralIds = new Set(
    order.filter((id) => !bodyIds.has(id) && !insertIds.has(id)),
  )
  const resolvedSelection = reconcileSelection(context, selection)
  const segments = resolvedSelection
    ? selectionSegmentMap(context, resolvedSelection)
    : new Map()
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

  function clearSelection() {
    clearSelectionState()
  }

  function mirrorSelection(
    paragraphId: string,
    from: number,
    to: number,
    direction: 'forward' | 'backward',
  ) {
    if (from === to) return
    if (resolvedSelection && !selectionCollapsed(resolvedSelection)) return
    if (insertIds.has(paragraphId) || structuralIds.has(paragraphId)) return
    const anchor = direction === 'backward' ? to : from
    const focus = direction === 'backward' ? from : to
    setSelection({
      anchor: { paragraphId, offset: anchor },
      focus: { paragraphId, offset: focus },
    })
    setSelectedParagraphId(paragraphId)
    setRestoreCaret({ paragraphId, offset: focus })
  }

  function selectParagraph(paragraphId: string, offset?: number) {
    if (
      offset != null &&
      !isVerticalDelivery(verticalCaret, { paragraphId, offset })
    ) {
      clearVerticalColumn(verticalCaret)
    }
    setSelection(null)
    setSelectionRefusal(null)
    setSelectedParagraphId(paragraphId)
    setRestoreCaret(offset == null ? null : { paragraphId, offset })
    setFormatRange(offset == null ? null : { from: offset, to: offset })
  }

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
    if (structuralIds.size > 0) {
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
    if (order.slice(from, to + 1).some((id) => insertIds.has(id))) {
      setSelectionRefusal('insert')
      return null
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

  function moveCaret(paragraphId: string, offset: number) {
    if (structuralIds.has(paragraphId)) return
    selectParagraph(paragraphId, offset)
  }

  function rejectSelectionInput() {
    setSelectionRefusal('input')
  }

  function reportJoinRefusal(refusal: DocumentRangeRefusal) {
    setSelectionRefusal(refusal)
  }

  const blurParagraph = closeEditingStory

  function splitSelectionRange() {
    const range = selectedRange()
    if (!model || !range) return
    const caret = drafts.splitDocumentRange(model, range.start, range.end)
    if (caret) selectParagraph(caret.paragraphId, caret.offset)
  }

  function insertAuthority(citation: string, italic: boolean) {
    if (!model) return
    const paragraphId = selectedParagraphId ?? editingStory?.paragraphs[0]?.id
    if (!paragraphId) return
    const paragraph = blockText(model, state ?? emptyEditorState(), paragraphId)
    const offset =
      restoreCaret?.paragraphId === paragraphId
        ? restoreCaret.offset
        : paragraph.length
    const text = /[^\s([“‘"']$/u.test(paragraph.slice(0, offset))
      ? ` ${citation}`
      : citation
    const caret = italic
      ? drafts.insertStyledText(model, paragraphId, offset, text, {
          italic: true,
        })
      : drafts.insertText(model, paragraphId, offset, text)
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
    editingKind,
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
    ...find,
    selectParagraph,
    insertAuthority,
    undoDocument,
    redoDocument,
  }
}
