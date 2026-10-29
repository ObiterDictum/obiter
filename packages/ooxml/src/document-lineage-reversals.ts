import type { DocumentLineageReversal } from '@obiter/contracts'
import type { LineageRecorder, RecordedTrackedChange } from './document-lineage'

export function buildTrackedReversals(recorder: LineageRecorder) {
  const byOperation = new Map<number, RecordedTrackedChange[]>()
  for (const change of recorder.trackedChanges) {
    const group = byOperation.get(change.operationIndex) ?? []
    group.push(change)
    byOperation.set(change.operationIndex, group)
  }

  const insertionChangeIds = new Map<string, string[]>()
  for (const [operation, group] of byOperation) {
    if (!group.every((change) => change.elementName === 'ins')) continue
    const inserted = [...recorder.paragraphOrigin.entries()].find(
      ([, origin]) =>
        origin.fromParagraphId === null &&
        origin.insertedByOperation === operation,
    )
    if (!inserted) continue
    insertionChangeIds.set(inserted[0].id, [
      ...new Set(group.map((change) => change.ooxmlId)),
    ])
  }

  const reversals: DocumentLineageReversal[] = []
  for (const [operation, group] of [...byOperation.entries()].sort(
    (left, right) => left[0] - right[0],
  )) {
    const first = group[0]
    if (!first) continue
    if (
      group.every((change) => change.elementName === 'ins') &&
      first.fromRunId === null
    ) {
      continue
    }
    reversals.push({
      operation,
      fromRunId: first.fromRunId,
      fromParagraphId: first.fromParagraphId,
      rejectOoxmlIds: [...new Set(group.map((change) => change.ooxmlId))],
    })
  }

  return { insertionChangeIds, reversals }
}
