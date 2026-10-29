import type { DocumentModelWire, DocumentStoryWire } from '@obiter/contracts'
import type { ParagraphDeletionOutcome } from '../../document-edits'
import { findInDocument, type FindMatchOptions } from '../../document-find'
import {
  replaceFindHits,
  type FindReplaceResult,
} from '../../document-find-replace'
import { mergeEmphasis } from '../../document-format-edits'
import { planParagraphDeletion } from '../../document-paragraph-deletion'
import type { DraftState } from '../../document-save-plan'
import type { HistoryEdit } from '../../document-history-grouping'
import { applyPasteText, type PasteTarget } from '../../document-paste'
import {
  applyReplaceDocumentRange,
  applySplitOverDocumentRange,
} from '../../document-range-edits'
import {
  applyInsertText,
  applyWordEdit,
  wordEditJoinRefusal,
  type EditorResult,
  type WordEditOutcome,
} from '../../document-word-edits'
import type { ParagraphWordEdit } from './model-paragraph'

export function createWorkspaceDraftEdits({
  getModel,
  getState,
  setState,
  checkpoint,
}: {
  getModel: () => DocumentModelWire | undefined
  getState: () => DraftState
  setState: (update: (current: DraftState) => DraftState) => void
  checkpoint: (edit?: HistoryEdit) => void
}) {
  function commitEditor(result: EditorResult) {
    setState((current) => ({
      ...current,
      drafts: result.state.drafts,
      inserts: result.state.inserts,
      deletedParagraphIds: result.state.deletedParagraphIds,
      extraRuns: result.state.extraRuns,
    }))
  }

  function handleWordEdit(
    model: DocumentModelWire,
    edit: ParagraphWordEdit,
  ): WordEditOutcome | null {
    const result = applyWordEdit(model, getState(), edit, crypto.randomUUID())
    if (result) {
      checkpoint(historyEditOf(edit))
      commitEditor(result)
      return { status: 'applied', caret: result.caret }
    }
    const refusal = wordEditJoinRefusal(model, getState(), edit)
    return refusal ? { status: 'refused', refusal } : null
  }

  function replaceDocumentRange(
    model: DocumentModelWire,
    from: { paragraphId: string; offset: number },
    to: { paragraphId: string; offset: number },
    text: string,
  ): { paragraphId: string; offset: number } | null {
    const result = applyReplaceDocumentRange(model, getState(), from, to, text)
    if (!result) return null
    checkpoint()
    commitEditor(result)
    return result.caret
  }

  function splitDocumentRange(
    model: DocumentModelWire,
    from: { paragraphId: string; offset: number },
    to: { paragraphId: string; offset: number },
  ): { paragraphId: string; offset: number } | null {
    const result = applySplitOverDocumentRange(
      model,
      getState(),
      from,
      to,
      crypto.randomUUID(),
    )
    if (!result) return null
    checkpoint()
    commitEditor(result)
    return result.caret
  }

  function replaceHits(
    model: DocumentModelWire,
    story: DocumentStoryWire | undefined,
    query: string,
    options: FindMatchOptions,
    replacement: string,
    which: number | 'all',
  ): FindReplaceResult {
    const state = getState()
    const hits = findInDocument(model, state, query, story, options)
    const result = replaceFindHits(model, state, hits, replacement, which, () =>
      crypto.randomUUID(),
    )
    if (result.status !== 'applied') return result
    checkpoint()
    commitEditor(result)
    return result
  }

  function insertText(
    model: DocumentModelWire,
    paragraphId: string,
    offset: number,
    text: string,
  ) {
    const result = applyInsertText(
      model,
      getState(),
      { paragraphId, offset },
      text,
    )
    if (!result) return null
    checkpoint()
    commitEditor(result)
    return result.caret
  }

  function insertStyledText(
    model: DocumentModelWire,
    paragraphId: string,
    offset: number,
    text: string,
    emphasis: { italic: true },
  ) {
    const result = applyInsertText(
      model,
      getState(),
      { paragraphId, offset },
      text,
    )
    if (!result) return null
    const pendingInsert = result.state.inserts.some(
      (item) => item.clientId === paragraphId,
    )
    checkpoint()
    setState((current) => ({
      ...current,
      drafts: result.state.drafts,
      inserts: result.state.inserts,
      deletedParagraphIds: result.state.deletedParagraphIds,
      extraRuns: result.state.extraRuns,
      ...(pendingInsert
        ? {}
        : {
            format: {
              ...current.format,
              emphasis: mergeEmphasis(current.format.emphasis, {
                paragraphId,
                from: offset,
                to: offset + text.length,
                ...emphasis,
              }),
            },
          }),
    }))
    return result.caret
  }

  function paste(
    model: DocumentModelWire,
    target: PasteTarget,
    text: string,
  ): WordEditOutcome | null {
    const outcome = applyPasteText(model, getState(), target, text, () =>
      crypto.randomUUID(),
    )
    if (outcome.status === 'applied') {
      checkpoint()
      commitEditor({ state: outcome.state, caret: outcome.caret })
      return { status: 'applied', caret: outcome.caret }
    }
    if (outcome.status === 'refused') {
      return { status: 'refused', refusal: outcome.refusal }
    }
    return null
  }

  function insertAfter(afterParagraphId: string) {
    checkpoint()
    const clientId = crypto.randomUUID()
    setState((current) => ({
      ...current,
      inserts: [...current.inserts, { clientId, afterParagraphId, text: '' }],
    }))
    return clientId
  }

  function deleteParagraph(paragraphId: string): ParagraphDeletionOutcome {
    const plan = planParagraphDeletion(getModel(), getState(), paragraphId)
    if (plan.kind === 'refused')
      return { status: 'refused', reason: plan.reason, selectId: null }
    if (plan.kind === 'unchanged') return { status: 'deleted', selectId: null }
    checkpoint()
    setState((current) => ({ ...current, ...plan.state }))
    return { status: 'deleted', selectId: plan.selectId }
  }

  return {
    handleWordEdit,
    replaceDocumentRange,
    splitDocumentRange,
    replaceHits,
    insertText,
    insertStyledText,
    paste,
    insertAfter,
    deleteParagraph,
  }
}

function historyEditOf(edit: ParagraphWordEdit): HistoryEdit {
  if (
    edit.type === 'replace' &&
    edit.from === edit.to &&
    edit.insert !== undefined &&
    edit.insert.length > 0
  ) {
    return {
      kind: 'typing',
      paragraphId: edit.paragraphId,
      inserted: edit.insert,
    }
  }
  return { kind: 'structural' }
}
