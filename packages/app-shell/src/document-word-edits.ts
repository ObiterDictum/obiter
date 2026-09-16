import type { DocumentModelWire, DocumentTextRunWire } from '@obiter/contracts'
import {
  flowParagraphIds,
  insertRuns,
  removeInsert,
  type LocalInsert,
} from './document-edits'
import { documentStory } from './document-model-text'
import { canJoinParagraphRuns } from './document-run-fidelity'
import { omitKey, replaceRunRange, splitRuns } from './document-run-range'
import { storyBodyParagraphIds } from './document-story-flow'

export type ExtraRuns = Record<string, DocumentTextRunWire[]>

export type EditorState = {
  drafts: Record<string, string>
  inserts: LocalInsert[]
  deletedParagraphIds: string[]
  extraRuns: ExtraRuns
}

export type EditorCaret = {
  paragraphId: string
  offset: number
}

export type EditorResult = {
  state: EditorState
  caret: EditorCaret
}

export function emptyEditorState(): EditorState {
  return { drafts: {}, inserts: [], deletedParagraphIds: [], extraRuns: {} }
}

export function blockRuns(
  model: DocumentModelWire,
  state: EditorState,
  paragraphId: string,
): DocumentTextRunWire[] {
  const insert = state.inserts.find((item) => item.clientId === paragraphId)
  if (insert) return insertRuns(insert)
  const paragraph = documentStory(model)?.paragraphs.find(
    (item) => item.id === paragraphId,
  )
  if (!paragraph) return []
  const extras = state.extraRuns[paragraphId] ?? []
  return [...paragraph.runs, ...extras].map((run) => ({
    ...run,
    text: state.drafts[run.id] ?? run.text,
  }))
}

export function blockText(
  model: DocumentModelWire,
  state: EditorState,
  paragraphId: string,
): string {
  return blockRuns(model, state, paragraphId)
    .map((run) => run.text)
    .join('')
}

function editableRuns(
  model: DocumentModelWire,
  state: EditorState,
  paragraphId: string,
  fallbackId: string,
): DocumentTextRunWire[] {
  const runs = blockRuns(model, state, paragraphId)
  return runs.length > 0
    ? runs
    : [{ id: fallbackId, text: '', preservedXmlFragments: [] }]
}

export function applyInsertText(
  model: DocumentModelWire,
  state: EditorState,
  caret: EditorCaret,
  text: string,
): EditorResult | undefined {
  if (!text) return { state, caret }
  const runs = editableRuns(
    model,
    state,
    caret.paragraphId,
    `${caret.paragraphId}-r0`,
  )
  return {
    state: writeRange(
      model,
      state,
      caret.paragraphId,
      runs,
      caret.offset,
      caret.offset,
      text,
    ),
    caret: {
      paragraphId: caret.paragraphId,
      offset: caret.offset + text.length,
    },
  }
}

export function applyDeleteBackward(
  model: DocumentModelWire,
  state: EditorState,
  caret: EditorCaret,
): EditorResult | undefined {
  if (caret.offset > 0) {
    const runs = blockRuns(model, state, caret.paragraphId)
    return {
      state: writeRange(
        model,
        state,
        caret.paragraphId,
        runs,
        caret.offset - 1,
        caret.offset,
        '',
      ),
      caret: { paragraphId: caret.paragraphId, offset: caret.offset - 1 },
    }
  }
  return joinIntoPrevious(model, state, caret.paragraphId)
}

export function applyDeleteForward(
  model: DocumentModelWire,
  state: EditorState,
  caret: EditorCaret,
): EditorResult | undefined {
  const text = blockText(model, state, caret.paragraphId)
  if (caret.offset < text.length) {
    const runs = blockRuns(model, state, caret.paragraphId)
    return {
      state: writeRange(
        model,
        state,
        caret.paragraphId,
        runs,
        caret.offset,
        caret.offset + 1,
        '',
      ),
      caret,
    }
  }
  const nextId = nextParagraphId(model, state, caret.paragraphId)
  if (!nextId) return undefined
  return joinIntoPrevious(model, state, nextId)
}

/** The paragraph after `paragraphId` in the editable flow, if any. */
function nextParagraphId(
  model: DocumentModelWire,
  state: EditorState,
  paragraphId: string,
): string | undefined {
  const order = flowParagraphIds(
    model,
    state.inserts,
    state.deletedParagraphIds,
  )
  return order[order.indexOf(paragraphId) + 1]
}

export function applyReplaceRange(
  model: DocumentModelWire,
  state: EditorState,
  paragraphId: string,
  from: number,
  to: number,
  insert: string,
): EditorResult | undefined {
  const runs = editableRuns(model, state, paragraphId, `${paragraphId}-r0`)
  return {
    state: writeRange(model, state, paragraphId, runs, from, to, insert),
    caret: { paragraphId, offset: from + insert.length },
  }
}

export function replaceFindHits(
  model: DocumentModelWire,
  state: EditorState,
  hits: ReadonlyArray<{ paragraphId: string; start: number; end: number }>,
  replacement: string,
  which: number | 'all',
): EditorResult | undefined {
  if (hits.length === 0) return undefined
  const selected =
    which === 'all' ? [...hits].reverse() : hits[which] ? [hits[which]] : []
  if (selected.length === 0) return undefined
  let current = state
  let caret = {
    paragraphId: selected[0]?.paragraphId ?? '',
    offset: selected[0]?.start ?? 0,
  }
  for (const hit of selected) {
    if (!hit) continue
    const result = applyReplaceRange(
      model,
      current,
      hit.paragraphId,
      hit.start,
      hit.end,
      replacement,
    )
    if (!result) continue
    current = result.state
    caret = result.caret
  }
  return { state: current, caret }
}

export function applySplitParagraph(
  model: DocumentModelWire,
  state: EditorState,
  caret: EditorCaret,
  newId: string,
): EditorResult | undefined {
  const runs = editableRuns(model, state, caret.paragraphId, `${newId}-src`)
  const { left, right } = splitRuns(runs, caret.offset, newId)
  const next = writeRuns(model, state, caret.paragraphId, left)
  return {
    state: {
      ...next,
      inserts: [
        ...next.inserts.map((item) =>
          item.afterParagraphId === caret.paragraphId
            ? { ...item, afterParagraphId: newId }
            : item,
        ),
        {
          clientId: newId,
          afterParagraphId: caret.paragraphId,
          text: right.map((run) => run.text).join(''),
          runs: right,
        },
      ],
    },
    caret: { paragraphId: newId, offset: 0 },
  }
}

export function applyLineBreak(
  model: DocumentModelWire,
  state: EditorState,
  caret: EditorCaret,
): EditorResult | undefined {
  return applyInsertText(model, state, caret, '\n')
}

export function joinIntoPrevious(
  model: DocumentModelWire,
  state: EditorState,
  paragraphId: string,
): EditorResult | undefined {
  if (paragraphJoinRefusal(model, state, paragraphId)) return undefined
  const order = flowParagraphIds(
    model,
    state.inserts,
    state.deletedParagraphIds,
  )
  const index = order.indexOf(paragraphId)
  if (index <= 0) return undefined
  const previousId = order[index - 1]
  if (!previousId) return undefined
  const moving = blockRuns(model, state, paragraphId)
  const caretOffset = blockText(model, state, previousId).length
  let next = appendRuns(state, previousId, moving)
  const removed = removeInsert(next.inserts, paragraphId)
  if (removed) {
    next = { ...next, inserts: removed.inserts }
  } else {
    next = {
      ...next,
      extraRuns: omitKey(next.extraRuns, paragraphId),
      deletedParagraphIds: next.deletedParagraphIds.includes(paragraphId)
        ? next.deletedParagraphIds
        : [...next.deletedParagraphIds, paragraphId],
    }
  }
  return {
    state: next,
    caret: { paragraphId: previousId, offset: caretOffset },
  }
}

export type JoinRefusal = 'structure' | 'join-formatting'

/** The outcome of a word edit: it applied (with the caret to place), or it
 * could not join a neighbour for a stated structural/formatting reason. */
export type WordEditOutcome =
  | { status: 'applied'; caret: EditorCaret }
  | { status: 'refused'; refusal: JoinRefusal }

/**
 * The reason a join into the paragraph before `paragraphId` is refused, or
 * null when it can proceed. This is the shared structural boundary a range
 * edit and a single-caret delete both pass through: only ordinary body
 * paragraphs (or a pending insert) may join, so a table cell or text-box
 * paragraph cannot be bridged, and a tail whose runs the save cannot restate
 * is refused before any draft state changes. A paragraph with no previous
 * neighbour has nothing to join and is not a refusal.
 */
export function paragraphJoinRefusal(
  model: DocumentModelWire,
  state: EditorState,
  paragraphId: string,
): JoinRefusal | null {
  const order = flowParagraphIds(
    model,
    state.inserts,
    state.deletedParagraphIds,
  )
  const index = order.indexOf(paragraphId)
  if (index <= 0) return null
  const previousId = order[index - 1]
  if (!previousId) return null
  const story = documentStory(model)
  const body = story ? storyBodyParagraphIds(story) : new Set<string>()
  const inserts = new Set(state.inserts.map((item) => item.clientId))
  const joinable = (id: string) => body.has(id) || inserts.has(id)
  if (!joinable(paragraphId) || !joinable(previousId)) return 'structure'
  const head = blockRuns(model, state, previousId)
  const moving = blockRuns(model, state, paragraphId)
  if (!canJoinParagraphRuns(head, moving)) return 'join-formatting'
  return null
}

/**
 * The reason a word edit cannot join, or null when it does not attempt a join
 * or the join is safe. Backspace joins the paragraph before the caret and
 * Delete joins the paragraph after it, so the target is resolved the same way
 * the two delete edits resolve it.
 */
export function wordEditJoinRefusal(
  model: DocumentModelWire,
  state: EditorState,
  edit: WordEdit,
): JoinRefusal | null {
  if (edit.type === 'deleteBackward') {
    if (edit.offset > 0) return null
    return paragraphJoinRefusal(model, state, edit.paragraphId)
  }
  if (edit.type === 'deleteForward') {
    if (edit.offset < blockText(model, state, edit.paragraphId).length) {
      return null
    }
    const nextId = nextParagraphId(model, state, edit.paragraphId)
    return nextId ? paragraphJoinRefusal(model, state, nextId) : null
  }
  return null
}

function appendRuns(
  state: EditorState,
  paragraphId: string,
  moving: DocumentTextRunWire[],
): EditorState {
  if (moving.length === 0) return state
  const insert = state.inserts.find((item) => item.clientId === paragraphId)
  if (insert) {
    const current =
      insert.runs && insert.runs.length > 0
        ? insert.runs
        : [
            {
              id: insert.clientId,
              text: insert.text,
              preservedXmlFragments: [],
            },
          ]
    const runs = [...current, ...moving]
    return {
      ...state,
      inserts: state.inserts.map((item) =>
        item.clientId === paragraphId
          ? { ...item, runs, text: runs.map((run) => run.text).join('') }
          : item,
      ),
    }
  }
  return {
    ...state,
    extraRuns: {
      ...state.extraRuns,
      [paragraphId]: [...(state.extraRuns[paragraphId] ?? []), ...moving],
    },
  }
}

export function writeRange(
  model: DocumentModelWire,
  state: EditorState,
  paragraphId: string,
  runs: DocumentTextRunWire[],
  from: number,
  to: number,
  insert: string,
): EditorState {
  return writeRuns(
    model,
    state,
    paragraphId,
    replaceRunRange(runs, from, to, insert),
  )
}

function writeRuns(
  model: DocumentModelWire,
  state: EditorState,
  paragraphId: string,
  runs: DocumentTextRunWire[],
): EditorState {
  const insert = state.inserts.find((item) => item.clientId === paragraphId)
  if (insert) {
    return {
      ...state,
      inserts: state.inserts.map((item) =>
        item.clientId === paragraphId
          ? { ...item, runs, text: runs.map((run) => run.text).join('') }
          : item,
      ),
    }
  }
  const originalIds = new Set(
    documentStory(model)
      ?.paragraphs.find((item) => item.id === paragraphId)
      ?.runs.map((run) => run.id) ?? [],
  )
  const drafts = { ...state.drafts }
  for (const id of originalIds) {
    drafts[id] = runs.find((run) => run.id === id)?.text ?? ''
  }
  // An edit that stays inside the stored runs adds no extra run. Storing an
  // empty list would make the paragraph look dirty and persist an empty entry.
  const extra = runs.filter((run) => !originalIds.has(run.id))
  return {
    ...state,
    drafts,
    extraRuns:
      extra.length > 0
        ? { ...state.extraRuns, [paragraphId]: extra }
        : omitKey(state.extraRuns, paragraphId),
  }
}

export type WordEdit = {
  type: 'replace' | 'deleteBackward' | 'deleteForward' | 'split' | 'lineBreak'
  paragraphId: string
  offset: number
  from?: number
  to?: number
  insert?: string
}

export function applyWordEdit(
  model: DocumentModelWire,
  state: EditorState,
  edit: WordEdit,
  newParagraphId: string,
): EditorResult | undefined {
  const caret = { paragraphId: edit.paragraphId, offset: edit.offset }
  if (edit.type === 'replace') {
    return applyReplaceRange(
      model,
      state,
      edit.paragraphId,
      edit.from ?? edit.offset,
      edit.to ?? edit.offset,
      edit.insert ?? '',
    )
  }
  if (edit.type === 'deleteBackward') {
    return applyDeleteBackward(model, state, caret)
  }
  if (edit.type === 'deleteForward') {
    return applyDeleteForward(model, state, caret)
  }
  if (edit.type === 'split') {
    return applySplitParagraph(model, state, caret, newParagraphId)
  }
  return applyLineBreak(model, state, caret)
}
