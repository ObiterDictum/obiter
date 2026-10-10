import type { DocumentModelWire, DocumentTextRunWire } from '@obiter/contracts'
import { editableParagraph, runsText } from './document-model-text'
import { omitKey, replaceRunRange } from './document-run-range'
import type { EditorState } from './document-word-edits'

/**
 * Appends runs onto a paragraph: a pending insert's runs and collapsed text
 * grow together, a stored paragraph accumulates the runs in `extraRuns`.
 */
export function appendRuns(
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
          ? { ...item, runs, text: runsText(runs) }
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

export function writeRuns(
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
          ? { ...item, runs, text: runsText(runs) }
          : item,
      ),
    }
  }
  const originalIds = new Set(
    editableParagraph(model, paragraphId)?.runs.map((run) => run.id) ?? [],
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
