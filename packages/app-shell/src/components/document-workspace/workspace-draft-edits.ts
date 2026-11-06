import type { DocumentModelWire, DocumentStoryWire } from '@obiter/contracts'
import type { ParagraphDeletionOutcome } from '../../document-edits'
import { findInDocument, type FindMatchOptions } from '../../document-find'
import {
  replaceFindHits,
  type FindReplaceResult,
} from '../../document-find-replace'
import { followFootnoteEdits } from '../../document-footnote-fold'
import { mergeEmphasis } from '../../document-format-edits'
import { planParagraphDeletion } from '../../document-paragraph-deletion'
import type { DraftState } from '../../document-save-plan'
import type { DocumentSelection } from '../../document-selection'
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
  function commitEditor(
    model: DocumentModelWire,
    result: EditorResult,
    selection?: DocumentSelection,
  ) {
    setState((current) => ({
      ...current,
      ...followFootnotes(model, current, result, selection),
      deletedParagraphIds: result.state.deletedParagraphIds,
    }))
  }

  function handleWordEdit(
    model: DocumentModelWire,
    edit: ParagraphWordEdit,
  ): WordEditOutcome | null {
    const result = applyWordEdit(model, getState(), edit, crypto.randomUUID())
    if (result) {
      checkpoint(historyEditOf(edit))
      commitEditor(
        model,
        result,
        edit.type === 'replace'
          ? {
              anchor: {
                paragraphId: edit.paragraphId,
                offset: edit.from ?? edit.offset,
              },
              focus: {
                paragraphId: edit.paragraphId,
                offset: edit.to ?? edit.offset,
              },
            }
          : undefined,
      )
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
  ): { paragraphId: string; offset: number; removedFootnotes: number } | null {
    const before = getState()
    const result = applyReplaceDocumentRange(model, getState(), from, to, text)
    if (!result) return null
    checkpoint()
    const after = followFootnotes(model, before, result, {
      anchor: from,
      focus: to,
    })
    setState((current) => ({
      ...current,
      ...after,
      deletedParagraphIds: result.state.deletedParagraphIds,
    }))
    const pendingRemoved = before.structures.filter(
      (item) =>
        item.kind === 'footnote' &&
        !after.structures.some((next) => next.id === item.id),
    ).length
    const storedRemoved = after.structures.filter(
      (item) =>
        item.kind === 'footnote-removal' &&
        !before.structures.some((previous) => previous.id === item.id),
    ).length
    return { ...result.caret, removedFootnotes: pendingRemoved + storedRemoved }
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
    commitEditor(model, result, { anchor: from, focus: to })
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
    commitEditor(model, result)
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
    commitEditor(model, result)
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
      ...followFootnotes(model, current, result),
      deletedParagraphIds: result.state.deletedParagraphIds,
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
      commitEditor(
        model,
        { state: outcome.state, caret: outcome.caret },
        target.kind === 'range'
          ? { anchor: target.from, focus: target.to }
          : undefined,
      )
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

function followFootnotes(
  model: DocumentModelWire,
  current: DraftState,
  result: EditorResult,
  selection?: DocumentSelection,
): Pick<DraftState, 'structures' | 'extraRuns' | 'drafts' | 'inserts'> {
  return followFootnoteEdits(
    model,
    current,
    result,
    current.structures,
    () => crypto.randomUUID(),
    selection,
  )
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
