import { documentEditOperationsSchema } from '@obiter/contracts'
import { OoxmlError } from './model'
import { recordTrackedChanges, type LineageRecorder } from './document-lineage'
import { planOperation, trackedRunIdOf } from './model-edit-plan'
import {
  validatePlannedOperations,
  validateTrackedOperations,
} from './model-edit-validation'
import { applyPlannedOperation, newEditApplyState } from './model-edit-apply'
import {
  applyRunEmphasisRanges,
  applyTrackedRunEmphasisRanges,
} from './model-run-emphasis'
import {
  createTrackedEditWriter,
  type TrackedEditContext,
} from './tracked-edits'

export type { TrackedEditContext } from './tracked-edits'

export function applyDocumentEdits(
  document: import('./model').OoxmlDocument,
  operations: readonly import('@obiter/contracts').DocumentEditOperation[],
  tracking?: TrackedEditContext,
  lineage?: LineageRecorder,
) {
  const parsed = documentEditOperationsSchema.safeParse(operations)
  if (!parsed.success) throw new OoxmlError('invalid-document-edit')

  const mainStory = document.model.stories.find(
    (story) => story.kind === 'document',
  )
  if (!mainStory) throw new OoxmlError('model-node-not-editable')
  const mainPart = document.sourceParts.get(mainStory.partName)
  if (!mainPart?.overlay || mainPart.kind !== 'xml') {
    throw new OoxmlError('model-node-not-editable')
  }

  const styleIds = new Set(document.model.styles.map(({ styleId }) => styleId))
  const numberingIds = new Set(
    document.model.numbering.map(({ numberingId }) => numberingId),
  )
  const runParagraphs = new Map(
    [...document.paragraphAnchors.values()].flatMap((paragraph) =>
      paragraph.runs.map((run) => [run.wire.id, paragraph] as const),
    ),
  )
  const planned = parsed.data.map((operation) =>
    planOperation(document, runParagraphs, operation, styleIds, numberingIds),
  )
  const deletedIds = validatePlannedOperations(
    document,
    planned,
    tracking !== undefined,
  )
  if (tracking) validateTrackedOperations(document, planned, deletedIds)
  const trackedWriter = tracking
    ? createTrackedEditWriter(document, tracking)
    : undefined

  const state = newEditApplyState()
  for (const [operationIndex, operation] of planned.entries()) {
    const paragraph = 'paragraph' in operation ? operation.paragraph : undefined
    applyPlannedOperation(
      { document, mainStory, trackedWriter, lineage, deletedIds, state },
      operation,
      operationIndex,
    )

    // A tracked operation names its reversal by the persisted `w:id`s it just
    // created. Taking them per operation keeps each history step's reversal a
    // unit: a replacement's `del`/`ins` pair is never split from its run. The
    // drain runs even when the operation has no paragraph so a stray change
    // cannot leak into the deferred range-emphasis recording below.
    if (trackedWriter && lineage) {
      const created = trackedWriter.takeChanges()
      if (created.length > 0) {
        recordTrackedChanges(lineage, created, {
          operationIndex,
          fromParagraphId: paragraph?.wire.id ?? null,
          fromRunId: trackedRunIdOf(operation),
        })
      }
    }
  }

  for (const [paragraph, ranges] of state.rangeEmphasis) {
    applyRunEmphasisRanges(document, paragraph, ranges, lineage)
  }
  if (trackedWriter) {
    for (const [paragraph, entry] of state.trackedRangeEmphasis) {
      applyTrackedRunEmphasisRanges(
        document,
        paragraph,
        entry.ranges,
        trackedWriter,
        lineage,
      )
      if (lineage) {
        const created = trackedWriter.takeChanges()
        if (created.length > 0) {
          recordTrackedChanges(lineage, created, {
            operationIndex: entry.operationIndex,
            fromParagraphId: paragraph.wire.id,
            fromRunId: null,
          })
        }
      }
    }
  }
}
