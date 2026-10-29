import {
  revisionOnlyParagraph,
  storedParagraphChanges,
} from './document-inline-index'
import type { DocumentModelWire, DocumentTextRunWire } from '@obiter/contracts'
import {
  fieldBoundarySplitIds,
  insertRuns,
  removeInsert,
  type LocalInsert,
} from './document-edits'
import {
  editableParagraph,
  editableParagraphs,
  effectiveParagraph,
  runsText,
} from './document-model-text'
import { canJoinParagraphRuns } from './document-run-fidelity'
import { omitKey, splitRuns } from './document-run-range'
import {
  editingStoryOfFlowId,
  storyBodyParagraphIds,
  storyFlowOrder,
} from './document-story-flow'
import { isNoteStory, sameNoteEntry } from './document-note-guard'
import { appendRuns, writeRange, writeRuns } from './document-write-runs'

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
  const paragraph = editableParagraph(model, paragraphId)
  if (!paragraph) {
    return state.extraRuns[paragraphId] ?? []
  }
  const extras = state.extraRuns[paragraphId] ?? []
  return effectiveParagraph(paragraph, state.drafts, extras).runs
}

export function blockText(
  model: DocumentModelWire,
  state: EditorState,
  paragraphId: string,
): string {
  return runsText(blockRuns(model, state, paragraphId))
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

function nextParagraphId(
  model: DocumentModelWire,
  state: EditorState,
  paragraphId: string,
): string | undefined {
  const order = storyFlowOrder(
    model,
    state.inserts,
    state.deletedParagraphIds,
    paragraphId,
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
          text: runsText(right),
          runs: right,
        },
      ],
    },
    caret: { paragraphId: newId, offset: 0 },
  }
}

function applyLineBreak(
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
  const order = storyFlowOrder(
    model,
    state.inserts,
    state.deletedParagraphIds,
    paragraphId,
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

export type JoinRefusal = 'structure' | 'join-formatting' | 'tracked-change'

export type WordEditOutcome =
  | { status: 'applied'; caret: EditorCaret }
  | { status: 'refused'; refusal: JoinRefusal }

export function paragraphJoinRefusal(
  model: DocumentModelWire,
  state: EditorState,
  paragraphId: string,
): JoinRefusal | null {
  const order = storyFlowOrder(
    model,
    state.inserts,
    state.deletedParagraphIds,
    paragraphId,
  )
  const index = order.indexOf(paragraphId)
  if (index <= 0) return null
  const previousId = order[index - 1]
  if (!previousId) return null
  const story = editingStoryOfFlowId(model, state.inserts, paragraphId)
  const body = story ? storyBodyParagraphIds(story) : new Set<string>()
  const inserts = new Set(state.inserts.map((item) => item.clientId))
  const joinable = (id: string) => body.has(id) || inserts.has(id)
  if (!joinable(paragraphId) || !joinable(previousId)) return 'structure'
  const into = editableParagraph(model, previousId)
  if (
    holdsTrackedChanges(model, paragraphId) ||
    (into && revisionOnlyParagraph(model, into))
  )
    return 'tracked-change'
  if (
    fieldBoundarySplitIds(
      model,
      new Set([...state.deletedParagraphIds, paragraphId]),
    )
  ) {
    return 'structure'
  }
  if (
    isNoteStory(story) &&
    !sameNoteEntry(
      story,
      state.inserts,
      new Set(editableParagraphs(model).map((item) => item.id)),
      paragraphId,
      previousId,
    )
  ) {
    return 'structure'
  }
  const head = blockRuns(model, state, previousId)
  const moving = blockRuns(model, state, paragraphId)
  if (!canJoinParagraphRuns(head, moving)) return 'join-formatting'
  return null
}

export function holdsTrackedChanges(
  model: DocumentModelWire,
  paragraphId: string,
) {
  const paragraph = editableParagraph(model, paragraphId)
  return !!paragraph && storedParagraphChanges(model, paragraph).length > 0
}

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
  const paragraph = editableParagraph(model, edit.paragraphId)
  if (paragraph && revisionOnlyParagraph(model, paragraph)) return undefined
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
    if (
      !editableParagraph(model, edit.paragraphId) &&
      !state.inserts.some((item) => item.clientId === edit.paragraphId)
    ) {
      return applyLineBreak(model, state, caret)
    }
    return applySplitParagraph(model, state, caret, newParagraphId)
  }
  return applyLineBreak(model, state, caret)
}
