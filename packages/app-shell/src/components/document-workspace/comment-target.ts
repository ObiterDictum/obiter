import { useMemo } from 'react'
import type { DocumentCommentAnchor } from '@obiter/contracts'

import {
  orderedSelection,
  selectionCollapsed,
  type DocumentSelection,
  type SelectionEndpoint,
} from '../../document-selection'

/**
 * The anchor a new comment would take — the live document selection's ordered
 * endpoints, across paragraphs when it spans them, or the caret's format
 * range where a collapse is an insertion point — plus card-to-anchor
 * navigation back to a stored anchor. Lives outside the caret hook because
 * the hook is at its source ceiling.
 */
export function useCommentAnchors(input: {
  order: readonly string[]
  selection: DocumentSelection | null
  selectedParagraphId: string | null
  formatRange: { from: number; to: number } | null
  actions: {
    closeEditingStory: () => void
    selectParagraph: (paragraphId: string, offset?: number) => void
    extendSelection: (
      focus: SelectionEndpoint,
      anchor: SelectionEndpoint,
    ) => void
  }
}) {
  const { order, selection, selectedParagraphId, formatRange, actions } = input
  const commentTarget: DocumentCommentAnchor | null = useMemo(
    () =>
      anchorForNewComment({
        order,
        selection,
        selectedParagraphId,
        formatRange,
      }),
    [order, selection, selectedParagraphId, formatRange],
  )
  const revealCommentAnchor = (anchor: DocumentCommentAnchor) =>
    revealAnchorRange(anchor, actions)
  return { commentTarget, revealCommentAnchor }
}

/**
 * The anchor a new comment would take. Null when there is no caret, so the
 * panel can say so rather than silently widening a missing target to a whole
 * paragraph.
 */
function anchorForNewComment(input: {
  order: readonly string[]
  selection: DocumentSelection | null
  selectedParagraphId: string | null
  formatRange: { from: number; to: number } | null
}): DocumentCommentAnchor | null {
  const { order, selection, selectedParagraphId, formatRange } = input
  if (selection && !selectionCollapsed(selection)) {
    const { start, end } = orderedSelection(order, selection)
    return {
      paragraphId: start.paragraphId,
      startOffset: start.offset,
      ...(end.paragraphId === start.paragraphId
        ? {}
        : { endParagraphId: end.paragraphId }),
      endOffset: end.offset,
    }
  }
  if (selectedParagraphId && formatRange) {
    return {
      paragraphId: selectedParagraphId,
      startOffset: formatRange.from,
      endOffset: formatRange.to,
    }
  }
  return null
}

/**
 * The range is painted as a document selection with the caret at its end; a
 * collapsed anchor is a plain caret placement. A margin story is left first
 * so the anchor's body paragraphs resolve in the order the selection
 * reconciles against; an anchor outside the reconciled order drops the
 * selection honestly instead of re-anchoring to different text.
 */
function revealAnchorRange(
  anchor: DocumentCommentAnchor,
  actions: {
    closeEditingStory: () => void
    selectParagraph: (paragraphId: string, offset?: number) => void
    extendSelection: (
      focus: SelectionEndpoint,
      anchor: SelectionEndpoint,
    ) => void
  },
) {
  actions.closeEditingStory()
  const endParagraphId = anchor.endParagraphId ?? anchor.paragraphId
  if (
    anchor.paragraphId === endParagraphId &&
    anchor.startOffset === anchor.endOffset
  ) {
    actions.selectParagraph(anchor.paragraphId, anchor.startOffset)
    return
  }
  actions.extendSelection(
    { paragraphId: endParagraphId, offset: anchor.endOffset },
    { paragraphId: anchor.paragraphId, offset: anchor.startOffset },
  )
}
