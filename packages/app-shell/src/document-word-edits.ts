import type { DocumentModelWire, DocumentTextRunWire } from '@obiter/contracts'
import {
  flowParagraphIds,
  insertRuns,
  removeInsert,
  type LocalInsert,
} from './document-edits'
import { documentStory } from './document-model-text'

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
  const order = flowParagraphIds(
    model,
    state.inserts,
    state.deletedParagraphIds,
  )
  const nextId = order[order.indexOf(caret.paragraphId) + 1]
  if (!nextId) return undefined
  return joinIntoPrevious(model, state, nextId)
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
        ...next.inserts,
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

function joinIntoPrevious(
  model: DocumentModelWire,
  state: EditorState,
  paragraphId: string,
): EditorResult | undefined {
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

function writeRange(
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
  return {
    ...state,
    drafts,
    extraRuns: {
      ...state.extraRuns,
      [paragraphId]: runs.filter((run) => !originalIds.has(run.id)),
    },
  }
}

function replaceRunRange(
  runs: DocumentTextRunWire[],
  from: number,
  to: number,
  insert: string,
): DocumentTextRunWire[] {
  if (runs.length === 0) {
    return [{ id: 'empty', text: insert, preservedXmlFragments: [] }]
  }
  let cursor = 0
  let written = false
  const next: DocumentTextRunWire[] = []
  for (const run of runs) {
    const start = cursor
    const end = cursor + run.text.length
    cursor = end
    if (end < from || start > to) {
      next.push(run)
      continue
    }
    const localFrom = Math.max(0, from - start)
    const localTo = Math.min(run.text.length, Math.max(0, to - start))
    const prefix = run.text.slice(0, localFrom)
    const suffix = run.text.slice(localTo)
    const piece = written ? '' : insert
    written = true
    next.push({ ...run, text: prefix + piece + suffix })
  }
  if (!written) {
    const last = next[next.length - 1]
    if (last) next[next.length - 1] = { ...last, text: last.text + insert }
  }
  return next
}

function splitRuns(
  runs: DocumentTextRunWire[],
  offset: number,
  newId: string,
): { left: DocumentTextRunWire[]; right: DocumentTextRunWire[] } {
  let cursor = 0
  const left: DocumentTextRunWire[] = []
  const right: DocumentTextRunWire[] = []
  let tail = 0
  for (const run of runs) {
    const start = cursor
    const end = cursor + run.text.length
    cursor = end
    if (end <= offset) left.push({ ...run })
    else if (start >= offset) {
      right.push({ ...run, id: `${newId}-r${tail}` })
      tail += 1
    } else {
      const at = offset - start
      if (at > 0) left.push({ ...run, text: run.text.slice(0, at) })
      right.push({
        ...run,
        id: `${newId}-r${tail}`,
        text: run.text.slice(at),
      })
      tail += 1
    }
  }
  if (left.length === 0) {
    left.push({ id: `${newId}-left`, text: '', preservedXmlFragments: [] })
  }
  if (right.length === 0) {
    right.push({ id: `${newId}-r0`, text: '', preservedXmlFragments: [] })
  }
  return { left, right }
}

function omitKey(record: ExtraRuns, key: string): ExtraRuns {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}
