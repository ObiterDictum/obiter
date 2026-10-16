import type { DocumentModelWire } from '@obiter/contracts'
import type { ParagraphDeletionOutcome } from '../../document-edits'
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
  replaceFindHits,
  wordEditJoinRefusal,
  type EditorResult,
  type WordEditOutcome,
} from '../../document-word-edits'
import type { ParagraphWordEdit } from './model-paragraph'

/**
 * The document-edit operations that record one history step and commit one
 * draft state. They live apart from `useWorkspaceDrafts`, which is already at
 * the source ceiling, and take the live state through a getter so each reads
 * the latest bundle rather than a render-stale closure.
 */
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
    // No result means the edit could not join a neighbour; say which boundary
    // refused it rather than leaving the keystroke silent.
    const refusal = wordEditJoinRefusal(model, getState(), edit)
    return refusal ? { status: 'refused', refusal } : null
  }

  /**
   * Replaces a selection that spans paragraphs. It is one draft-state change,
   * so a rejected or impossible range leaves the document exactly as it was.
   */
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

  /** Enter over a selection: collapse the range, then split where it was. */
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
    hits: ReadonlyArray<{ paragraphId: string; start: number; end: number }>,
    replacement: string,
    which: number | 'all',
  ) {
    const result = replaceFindHits(model, getState(), hits, replacement, which)
    if (!result) return null
    checkpoint()
    commitEditor(result)
    return result.caret
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

  /**
   * `insertText` with a formatting draft over the inserted range in the same
   * history step — the citation style's italic form. The range addresses
   * post-insert effective text, which is what the save writer's
   * `set_run_emphasis` resolves.
   *
   * A paragraph that exists only as a pending insert cannot carry run
   * emphasis anywhere in the editor (the Bold button reads the same
   * boundary), so the draft is not written there: it would only surface as a
   * blocked slot at save. The citation still lands as plain text.
   */
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

  /** A paste is one edit and one history step, however many paragraphs it
   * creates; the pure splitter supplies the resulting state. */
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
    // The invariant is checked before this checkpoint, so a refused deletion
    // leaves no undo entry and no pending edit operation behind.
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

/** A pure insertion of text that a keystroke can have produced is typing; a
 * multi-character or range-affecting replace, a delete, a split and a hard
 * break are all structural and get their own history step. */
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
