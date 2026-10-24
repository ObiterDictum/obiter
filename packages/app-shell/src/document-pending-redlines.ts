import { paragraphChanges } from './document-inline-index'
import {
  planTextRevision,
  type DocumentChangeWire,
  type DocumentModelWire,
  type DocumentParagraphWire,
  type DocumentStoryWire,
  type DocumentEditOperation,
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

export type PendingRedlineModel = DocumentModelWire & {
  pendingChanges?: PendingInlineChange[]
  pendingBuckets?: ReadonlyMap<string, PendingInlineChange[]>
}
export const NO_PENDING_CHANGES: PendingInlineChange[] = []

export function allPendingChanges(model: PendingRedlineModel) {
  return model.pendingChanges ?? NO_PENDING_CHANGES
}

export function pendingParagraphChanges(
  model: PendingRedlineModel,
  id: string,
  partName?: string,
): PendingInlineChange[] {
  const bucket = model.pendingBuckets?.get(id)
  if (model.pendingBuckets)
    return !partName ||
      bucket?.every((change) => change.storyPartName === partName)
      ? (bucket ?? NO_PENDING_CHANGES)
      : (bucket?.filter((change) => change.storyPartName === partName) ??
          NO_PENDING_CHANGES)
  return paragraphChanges(
    { id, runs: [], preservedXmlFragments: [] },
    model.pendingChanges ?? NO_PENDING_CHANGES,
    partName,
  )
}

type ParagraphSource = {
  story: DocumentStoryWire
  paragraph: DocumentParagraphWire
}
const sourceIndexes = new WeakMap<
  DocumentModelWire,
  {
    paragraphs: Map<string, ParagraphSource>
    runs: Map<string, ParagraphSource>
  }
>()
function sourceIndex(model: DocumentModelWire) {
  let index = sourceIndexes.get(model)
  if (!index) {
    index = { paragraphs: new Map(), runs: new Map() }
    for (const story of model.stories)
      for (const paragraph of story.paragraphs) {
        const source = { story, paragraph }
        index.paragraphs.set(paragraph.id, source)
        for (const run of paragraph.runs) index.runs.set(run.id, source)
      }
    sourceIndexes.set(model, index)
  }
  return index
}
const previousBuckets = new WeakMap<
  DocumentModelWire,
  Map<string, PendingInlineChange[]>
>()

export function withPendingRedlines(
  model: DocumentModelWire,
  state: DraftState,
  painted: DocumentModelWire = model,
  operations: readonly DocumentEditOperation[] = planDocumentSave(model, state)
    .operations,
): PendingRedlineModel {
  const replacements = new Map(
    operations.flatMap((op) =>
      op.type === 'replace_run_text' ? [[op.runId, op.text] as const] : [],
    ),
  )
  const pending: PendingInlineChange[] = []
  const counts = new Map<string, number>()
  function add(
    part: string,
    paragraphId: string,
    text: string,
    deleted: boolean,
    from: number,
    {
      paragraphDelete = false,
      displayOnly = false,
      paragraphInsert = false,
      runId,
    }: {
      paragraphDelete?: boolean
      displayOnly?: boolean
      paragraphInsert?: boolean
      runId?: string
    } = {},
  ) {
    if (!text && !paragraphDelete && !paragraphInsert) return
    const number = counts.get(paragraphId) ?? 0
    counts.set(paragraphId, number + 1)
    const base = {
      id: `pending:${paragraphId}:${number}`,
      storyPartName: part,
      ...(runId ? { runId } : {}),
      paragraphId,
      text: text || '¶',
      inlinePosition: { beforeRunId: null },
      pending: {
        from,
        to: deleted || displayOnly ? from : from + text.length,
        displayOnly: displayOnly || (paragraphInsert && !text),
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
  const index = sourceIndex(model)
  const affected = new Set<ParagraphSource>()
  const replacingEmpty = new Set<string>()
  const propertyRuns = new Set<string>()
  const styledRuns = new Set<string>()
  for (const op of operations) {
    if (op.type === 'set_run_style') styledRuns.add(op.runId)
    if (op.type === 'replace_run_text') {
      if (styledRuns.has(op.runId)) propertyRuns.add(op.runId)
      const source = index.runs.get(op.runId)
      if (source) affected.add(source)
    } else if (op.type === 'delete_paragraph') {
      const source = index.paragraphs.get(op.paragraphId)
      if (source) affected.add(source)
    } else if (
      op.type === 'insert_paragraph_before' ||
      op.type === 'insert_paragraph_after'
    ) {
      const source = index.paragraphs.get(op.paragraphId)
      if (!source) continue
      const text = op.runs?.map((run) => run.text).join('') ?? op.text ?? ''
      add(
        source.story.partName,
        op.intentId ?? op.paragraphId,
        text,
        false,
        0,
        { paragraphInsert: true },
      )
      if (!op.intentId) replacingEmpty.add(op.paragraphId)
    }
  }
  for (const { story, paragraph } of affected) {
    if (deleted.has(paragraph.id) && !replacingEmpty.has(paragraph.id)) {
      add(
        story.partName,
        paragraph.id,
        paragraph.runs
          .map(
            (run) =>
              planTextRevision(
                run.text,
                '',
                false,
                run.textRevisionTokens,
                false,
                run.textRevisionTextRanges?.length,
              ).removed,
          )
          .join(''),
        true,
        0,
        { paragraphDelete: true },
      )
      continue
    }
    let offset = 0
    for (const run of paragraph.runs) {
      const next = (replacements.get(run.id) ?? run.text).replace(
        /\r\n|\r/gu,
        '\n',
      )
      if (replacements.has(run.id)) {
        const plan = planTextRevision(
          run.text,
          next,
          run.textRevisionEligible === true,
          run.textRevisionTokens,
          propertyRuns.has(run.id),
          run.textRevisionTextRanges?.length,
        )
        const at = offset + plan.prefixLength
        add(story.partName, paragraph.id, plan.removed, true, at, {
          runId: run.id,
        })
        add(story.partName, paragraph.id, plan.editableInserted, false, at, {
          runId: run.id,
        })
        for (const retained of plan.retained)
          add(
            story.partName,
            paragraph.id,
            retained.text,
            false,
            offset + retained.offset,
            { displayOnly: true, runId: run.id },
          )
      }
      offset += next.length
    }
  }
  const buckets = new Map<string, PendingInlineChange[]>()
  for (const change of pending) {
    const id = change.paragraphId
    if (!id) continue
    const bucket = buckets.get(id) ?? []
    bucket.push(change)
    buckets.set(id, bucket)
  }
  const previous = previousBuckets.get(model)
  for (const [id, bucket] of buckets) {
    const old = previous?.get(id)
    if (old && JSON.stringify(old) === JSON.stringify(bucket))
      buckets.set(id, old)
  }
  previousBuckets.set(model, buckets)
  return pending.length
    ? { ...painted, pendingChanges: pending, pendingBuckets: buckets }
    : painted
}

export function pendingParagraphDeletion(
  model: PendingRedlineModel,
  id: string,
) {
  return pendingParagraphChanges(model, id).some(
    (change) => change.pending?.paragraphDelete,
  )
}
