import {
  planTextRevision,
  type DocumentChangeWire,
  type DocumentModelWire,
} from '@obiter/contracts'
import type { DraftState } from './document-draft-state'
import { planDocumentSave } from './document-save-plan'

/** Local paint descriptors never enter model storage or review decisions. */
export type PendingInlineChange = DocumentChangeWire & {
  pending?: {
    from: number
    to: number
    paragraphDelete?: boolean
    displayOnly?: boolean
  }
}

export function withPendingRedlines(
  model: DocumentModelWire,
  state: DraftState,
  painted: DocumentModelWire = model,
): DocumentModelWire {
  const { operations } = planDocumentSave(model, state)
  const replacements = new Map(
    operations.flatMap((op) =>
      op.type === 'replace_run_text' ? [[op.runId, op.text] as const] : [],
    ),
  )
  const pending: PendingInlineChange[] = []
  function add(
    part: string,
    paragraphId: string,
    text: string,
    deleted: boolean,
    from: number,
    paragraphDelete = false,
    displayOnly = false,
  ) {
    if (!text && !paragraphDelete) return
    const base = {
      id: `pending:${paragraphId}:${pending.length}`,
      storyPartName: part,
      paragraphId,
      text: text || '¶',
      inlinePosition: { beforeRunId: null },
      pending: {
        from,
        to: deleted || displayOnly ? from : from + text.length,
        displayOnly,
        paragraphDelete,
      },
    }
    pending.push(
      deleted
        ? { ...base, kind: 'delete', elementName: 'del' }
        : { ...base, kind: 'insert', elementName: 'ins' },
    )
  }
  const deleted = new Set(
    operations.flatMap((op) =>
      op.type === 'delete_paragraph' ? [op.paragraphId] : [],
    ),
  )
  for (const story of model.stories) {
    for (const paragraph of story.paragraphs) {
      for (const op of operations) {
        if (
          (op.type === 'insert_paragraph_before' ||
            op.type === 'insert_paragraph_after') &&
          op.paragraphId === paragraph.id
        ) {
          const text = op.runs?.map((run) => run.text).join('') ?? op.text ?? ''
          add(story.partName, op.intentId ?? paragraph.id, text, false, 0)
        }
      }
      if (
        deleted.has(paragraph.id) &&
        !operations.some(
          (op) =>
            op.type === 'insert_paragraph_after' &&
            op.paragraphId === paragraph.id &&
            !op.intentId,
        )
      ) {
        add(
          story.partName,
          paragraph.id,
          paragraph.runs
            .map(
              (run) =>
                run.textRevisionTokens?.map((token) => token.text).join('') ??
                run.text,
            )
            .join(''),
          true,
          0,
          true,
        )
        continue
      }
      let offset = 0
      for (const run of paragraph.runs) {
        const next = replacements.get(run.id) ?? run.text
        if (replacements.has(run.id)) {
          const plan = planTextRevision(
            run.text,
            next,
            run.textRevisionEligible === true,
            run.textRevisionTokens,
          )
          const at = offset + plan.prefixLength
          add(story.partName, paragraph.id, plan.removed, true, at)
          add(story.partName, paragraph.id, plan.editableInserted, false, at)
          for (const retained of plan.retained)
            add(
              story.partName,
              paragraph.id,
              retained.text,
              false,
              offset + retained.offset,
              false,
              true,
            )
        }
        offset += next.length
      }
    }
  }
  return pending.length
    ? { ...painted, changes: [...painted.changes, ...pending] }
    : painted
}

export function pendingParagraphDeletion(model: DocumentModelWire, id: string) {
  return model.changes.some(
    (change: PendingInlineChange) =>
      change.paragraphId === id && change.pending?.paragraphDelete,
  )
}
