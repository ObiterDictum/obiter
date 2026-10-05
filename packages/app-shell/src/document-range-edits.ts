import type { DocumentModelWire } from '@obiter/contracts'
import { flowParagraphIds, removeInsert } from './document-edits'
import { documentStory } from './document-model-text'
import { storyBodyParagraphIds } from './document-story-flow'
import { canJoinParagraphRuns } from './document-run-fidelity'
import {
  applyReplaceRange,
  applySplitParagraph,
  blockRuns,
  blockText,
  joinIntoPrevious,
  writeRange,
  type EditorCaret,
  type EditorResult,
  type EditorState,
} from './document-word-edits'

/** Why a document range cannot be replaced. `structure` means the range would
 * cross a paragraph that is not ordinary body text (a table cell, say), which
 * the editor cannot paint and a join would corrupt. `join-formatting` means the
 * surviving tail cannot be restated on save, so the join is refused rather than
 * painting formatting persistence would discard. */
export type DocumentRangeRefusal = 'structure' | 'join-formatting'

/**
 * The reason `applyReplaceDocumentRange` would refuse this range, or null when
 * it can apply. The caret uses this to say why a range edit was refused instead
 * of failing silently; the apply function calls it so the two cannot disagree.
 */
export function documentRangeRefusal(
  model: DocumentModelWire,
  state: EditorState,
  from: EditorCaret,
  to: EditorCaret,
): DocumentRangeRefusal | null {
  const story = documentStory(model)
  if (!story) return 'structure'
  const order = flowParagraphIds(
    model,
    state.inserts,
    state.deletedParagraphIds,
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
    const head = blockRuns(model, state, from.paragraphId)
    const moving = blockRuns(model, state, to.paragraphId)
    if (!canJoinParagraphRuns(head, moving)) return 'join-formatting'
  }
  return null
}

/**
 * Replaces the range between two paragraph endpoints with plain text, spanning
 * as many paragraphs as the range covers. It is composed from the existing
 * single-paragraph operations rather than a new document rewrite: the first
 * paragraph keeps everything before the range, the last keeps everything after
 * it, every paragraph selected whole between them is deleted, and the two
 * survivors are joined the way Backspace-at-start joins them. The batch
 * therefore serialises as ordinary replace_run_text and delete_paragraph
 * operations, and a range that cannot be resolved mutates nothing. A range that
 * would cross a structural paragraph, or move runs the save cannot restate, is
 * refused up front by `documentRangeRefusal`.
 */
export function applyReplaceDocumentRange(
  model: DocumentModelWire,
  state: EditorState,
  from: EditorCaret,
  to: EditorCaret,
  insert: string,
): EditorResult | undefined {
  if (documentRangeRefusal(model, state, from, to)) return undefined
  const order = flowParagraphIds(
    model,
    state.inserts,
    state.deletedParagraphIds,
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

/**
 * Enter over a range: the range collapses first, then the merged paragraph
 * splits where the range was, so Enter replaces a selection with a paragraph
 * break the way a word processor does. Both steps run on one state so the
 * split sees the join; two separate calls would plan the split from the state
 * before the deletion.
 */
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

/** Drops everything from `offset` to the end of the paragraph. */
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

/** Drops everything before `offset` in the paragraph. */
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

/**
 * Deletes a paragraph the selection covers whole. A pending inserted paragraph
 * is removed from the insert list; a stored one is marked deleted and any runs
 * a previous edit appended to it are dropped, so nothing of it can reappear.
 */
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
