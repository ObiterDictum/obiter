import type { DocumentModelWire } from '@obiter/contracts'
import { fieldBoundarySplitIds, removeInsert } from './document-edits'
import {
  editingStoryOfFlowId,
  storyBodyParagraphIds,
  storyFlowOrder,
} from './document-story-flow'
import { canJoinParagraphRuns } from './document-run-fidelity'
import { revisionOnlyParagraph } from './document-inline-index'
import { editableParagraph } from './document-model-text'
import {
  applyReplaceRange,
  applySplitParagraph,
  blockRuns,
  blockText,
  holdsTrackedChanges,
  joinIntoPrevious,
  type JoinRefusal,
  type EditorCaret,
  type EditorResult,
  type EditorState,
} from './document-word-edits'
import { writeRange } from './document-write-runs'

export type DocumentRangeRefusal = JoinRefusal

export function documentRangeRefusal(
  model: DocumentModelWire,
  state: EditorState,
  from: EditorCaret,
  to: EditorCaret,
): DocumentRangeRefusal | null {
  const story = editingStoryOfFlowId(model, state.inserts, from.paragraphId)
  if (!story) return 'structure'
  const order = storyFlowOrder(
    model,
    state.inserts,
    state.deletedParagraphIds,
    from.paragraphId,
  )
  const startIndex = order.indexOf(from.paragraphId)
  const endIndex = order.indexOf(to.paragraphId)
  if (startIndex === -1 || endIndex === -1 || startIndex > endIndex) {
    return 'structure'
  }
  const body = storyBodyParagraphIds(story)
  const insertIds = new Set(state.inserts.map((item) => item.clientId))
  for (let index = startIndex; index <= endIndex; index += 1) {
    const id = order[index]
    if (id === undefined) return 'structure'
    if (!body.has(id) && !insertIds.has(id)) return 'structure'
  }
  if (startIndex !== endIndex) {
    const removed = order
      .slice(startIndex + 1, endIndex + 1)
      .filter((id) => body.has(id))
    const first = editableParagraph(model, from.paragraphId)
    if (
      removed.some((id) => holdsTrackedChanges(model, id)) ||
      (first && revisionOnlyParagraph(model, first))
    ) {
      return 'tracked-change'
    }
    if (
      fieldBoundarySplitIds(
        model,
        new Set([...state.deletedParagraphIds, ...removed]),
      )
    ) {
      return 'structure'
    }
    const head = blockRuns(model, state, from.paragraphId)
    const moving = blockRuns(model, state, to.paragraphId)
    if (!canJoinParagraphRuns(head, moving)) return 'join-formatting'
  }
  return null
}

export function applyReplaceDocumentRange(
  model: DocumentModelWire,
  state: EditorState,
  from: EditorCaret,
  to: EditorCaret,
  insert: string,
): EditorResult | undefined {
  if (documentRangeRefusal(model, state, from, to)) return undefined
  const order = storyFlowOrder(
    model,
    state.inserts,
    state.deletedParagraphIds,
    from.paragraphId,
  )
  const startIndex = order.indexOf(from.paragraphId)
  const endIndex = order.indexOf(to.paragraphId)
  if (startIndex === -1 || endIndex === -1) return undefined
  if (startIndex === endIndex) {
    if (from.offset === to.offset && insert === '') {
      return { state, caret: from }
    }
    return applyReplaceRange(
      model,
      state,
      from.paragraphId,
      from.offset,
      to.offset,
      insert,
    )
  }
  if (startIndex > endIndex) return undefined

  let current = trimSuffix(model, state, from.paragraphId, from.offset)
  current = trimPrefix(model, current, to.paragraphId, to.offset)
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const paragraphId = order[index]
    if (paragraphId !== undefined) {
      current = removeParagraph(current, paragraphId)
    }
  }
  const joined = joinIntoPrevious(model, current, to.paragraphId)
  if (!joined) return undefined
  current = joined.state

  const insertAt = Math.min(
    from.offset,
    blockText(model, current, from.paragraphId).length,
  )
  if (insert !== '') {
    current = writeRange(
      model,
      current,
      from.paragraphId,
      blockRuns(model, current, from.paragraphId),
      insertAt,
      insertAt,
      insert,
    )
  }
  return {
    state: current,
    caret: { paragraphId: from.paragraphId, offset: insertAt + insert.length },
  }
}

export function applySplitOverDocumentRange(
  model: DocumentModelWire,
  state: EditorState,
  from: EditorCaret,
  to: EditorCaret,
  newParagraphId: string,
): EditorResult | undefined {
  const deleted = applyReplaceDocumentRange(model, state, from, to, '')
  if (!deleted) return undefined
  return applySplitParagraph(
    model,
    deleted.state,
    deleted.caret,
    newParagraphId,
  )
}

function trimSuffix(
  model: DocumentModelWire,
  state: EditorState,
  paragraphId: string,
  offset: number,
): EditorState {
  const text = blockText(model, state, paragraphId)
  const at = Math.max(0, Math.min(offset, text.length))
  if (at >= text.length) return state
  return writeRange(
    model,
    state,
    paragraphId,
    blockRuns(model, state, paragraphId),
    at,
    text.length,
    '',
  )
}

function trimPrefix(
  model: DocumentModelWire,
  state: EditorState,
  paragraphId: string,
  offset: number,
): EditorState {
  const text = blockText(model, state, paragraphId)
  const at = Math.max(0, Math.min(offset, text.length))
  if (at <= 0) return state
  return writeRange(
    model,
    state,
    paragraphId,
    blockRuns(model, state, paragraphId),
    0,
    at,
    '',
  )
}

function removeParagraph(state: EditorState, paragraphId: string): EditorState {
  const removed = removeInsert(state.inserts, paragraphId)
  if (removed) return { ...state, inserts: removed.inserts }
  if (state.deletedParagraphIds.includes(paragraphId)) return state
  const extraRuns = { ...state.extraRuns }
  delete extraRuns[paragraphId]
  return {
    ...state,
    extraRuns,
    deletedParagraphIds: [...state.deletedParagraphIds, paragraphId],
  }
}
