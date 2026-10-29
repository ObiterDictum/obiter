import { useMemo } from 'react'
import type { DocumentCommentAnchor } from '@obiter/contracts'

import {
  orderedSelection,
  selectionCollapsed,
  type DocumentSelection,
  type SelectionEndpoint,
} from '../../document-selection'

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
