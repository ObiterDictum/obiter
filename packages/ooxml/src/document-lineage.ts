import type {
  DocumentLineageReversal,
  DocumentLineageSegment,
  DocumentLineageRun,
  DocumentModelWire,
  DocumentParagraphLineage,
  DocumentParagraphWire,
  DocumentTextRunWire,
  DocumentVersionLineage,
} from '@obiter/contracts'

/**
 * Authoritative edit lineage, gathered while operations are applied.
 *
 * A run that exists in the base model is tracked by its object identity, so a
 * split, merge or move is recorded by construction rather than inferred from a
 * reparsed document. The result side of the lineage is expressed as a result
 * paragraph id (persisted as `w14:paraId`) plus a run index, because run model
 * ids are reallocated on every parse and are not a cross-version identity.
 */
export type LineageRecorder = {
  /** Indexes in the submitted batch that were actually applied. */
  accepted: number[]
  /** Length in code units of each base run, keyed by base run id. */
  baseRunLengths: Map<string, number>
  /**
   * Per current run object, the base segments that compose it, in order. The
   * segment lengths sum to the run's text length unless the run was text
   * replaced, in which case the segments are kept whole and not sliced again.
   */
  runOrigins: Map<DocumentTextRunWire, DocumentLineageSegment[]>
  /** Runs whose text was replaced, so their segments are coarse, not a partition. */
  replacedRuns: WeakSet<DocumentTextRunWire>
  /** Base paragraph origin for every current paragraph touched by the batch. */
  paragraphOrigin: Map<
    DocumentParagraphWire,
    {
      fromParagraphId: string | null
      insertedByOperation?: number
      insertedByIntent?: string
    }
  >
  /** Base paragraphs deleted by the batch, keyed by base paragraph id. */
  deletedParagraphs: Map<string, { insertedByOperation?: number }>
  /** Paragraphs this batch touched, in insertion order. */
  touched: Set<DocumentParagraphWire>
  /**
   * Tracked-change elements the batch created, each tagged with the accepted
   * operation that created it and the base node it addresses. A tracked
   * operation's reversal is a rejection of these persisted `w:id`s, never a
   * positional run address.
   */
  trackedChanges: RecordedTrackedChange[]
}

/** One tracked-change element created while applying an accepted batch. */
export type RecordedTrackedChange = {
  operationIndex: number
  elementName: 'ins' | 'del' | 'rPrChange' | 'pPrChange'
  ooxmlId: string
  fromParagraphId: string | null
  fromRunId: string | null
}

export function createLineageRecorder(
  model: DocumentModelWire,
): LineageRecorder {
  const baseRunLengths = new Map<string, number>()
  for (const story of model.stories) {
    for (const paragraph of story.paragraphs) {
      for (const run of paragraph.runs) {
        baseRunLengths.set(run.id, run.text.length)
      }
    }
  }
  return {
    accepted: [],
    baseRunLengths,
    runOrigins: new Map(),
    replacedRuns: new WeakSet(),
    paragraphOrigin: new Map(),
    deletedParagraphs: new Map(),
    touched: new Set(),
    trackedChanges: [],
  }
}

/**
 * Records the tracked-change elements one accepted operation created. A tracked
 * operation produces one or more records (a replacement produces a `del` and
 * an `ins`); they are reversed together as one unit.
 */
export function recordTrackedChanges(
  recorder: LineageRecorder,
  changes: readonly Pick<RecordedTrackedChange, 'elementName' | 'ooxmlId'>[],
  context: {
    operationIndex: number
    fromParagraphId: string | null
    fromRunId: string | null
  },
) {
  for (const change of changes) {
    recorder.trackedChanges.push({
      operationIndex: context.operationIndex,
      elementName: change.elementName,
      ooxmlId: change.ooxmlId,
      fromParagraphId: context.fromParagraphId,
      fromRunId: context.fromRunId,
    })
  }
}

/** The segments a freshly parsed run carries before any edit. */
export function seedRunOrigins(
  recorder: LineageRecorder,
  run: DocumentTextRunWire,
) {
  if (!recorder.runOrigins.has(run)) {
    recorder.runOrigins.set(run, [
      {
        fromRunId: run.id,
        fromOffset: 0,
        toOffset: recorder.baseRunLengths.get(run.id) ?? run.text.length,
      },
    ])
  }
}

/** Marks a paragraph as transformed by operation `operationIndex`. */
export function touchParagraph(
  recorder: LineageRecorder,
  paragraph: DocumentParagraphWire,
  operationIndex: number,
) {
  recorder.touched.add(paragraph)
  if (!recorder.paragraphOrigin.has(paragraph)) {
    recorder.paragraphOrigin.set(paragraph, {
      fromParagraphId: paragraph.id,
    })
  }
  if (!recorder.accepted.includes(operationIndex)) {
    recorder.accepted.push(operationIndex)
  }
}

export function recordInsertedParagraph(
  recorder: LineageRecorder,
  paragraph: DocumentParagraphWire,
  operationIndex: number,
  intentId?: string,
) {
  recorder.touched.add(paragraph)
  recorder.paragraphOrigin.set(paragraph, {
    fromParagraphId: null,
    insertedByOperation: operationIndex,
    ...(intentId ? { insertedByIntent: intentId } : {}),
  })
  for (const run of paragraph.runs) {
    recorder.runOrigins.set(run, [
      { fromRunId: null, fromOffset: 0, toOffset: 0 },
    ])
    seedRunOrigins(recorder, run)
  }
  if (!recorder.accepted.includes(operationIndex)) {
    recorder.accepted.push(operationIndex)
  }
}

export function recordDeletedParagraph(
  recorder: LineageRecorder,
  paragraph: DocumentParagraphWire,
  operationIndex: number,
) {
  recorder.deletedParagraphs.set(paragraph.id, {})
  if (!recorder.accepted.includes(operationIndex)) {
    recorder.accepted.push(operationIndex)
  }
}

/** Marks a run's text as changed, so its segments are coarse provenance. */
export function recordReplacedRun(
  recorder: LineageRecorder,
  run: DocumentTextRunWire,
) {
  recorder.replacedRuns.add(run)
  seedRunOrigins(recorder, run)
}

/**
 * The base segments composing `[from, to)` of a run whose text is a partition
 * of its segments. Callers must not use this on a replaced run.
 */
export function sliceRunOrigins(
  origins: readonly DocumentLineageSegment[],
  from: number,
  to: number,
): DocumentLineageSegment[] {
  const sliced: DocumentLineageSegment[] = []
  let cursor = 0
  for (const segment of origins) {
    const length = segment.toOffset - segment.fromOffset
    const segmentStart = cursor
    const segmentEnd = cursor + length
    cursor = segmentEnd
    const start = Math.max(from, segmentStart)
    const end = Math.min(to, segmentEnd)
    if (start >= end) continue
    sliced.push({
      fromRunId: segment.fromRunId,
      fromOffset:
        segment.fromRunId === null
          ? 0
          : segment.fromOffset + (start - segmentStart),
      toOffset:
        segment.fromRunId === null
          ? 0
          : segment.fromOffset + (end - segmentStart),
    })
  }
  if (sliced.length === 0) {
    // A zero-length piece still needs provenance: anchor it at the cut so the
    // client never sees an unowned result run.
    let cursor = 0
    for (const segment of origins) {
      const length = segment.toOffset - segment.fromOffset
      const segmentStart = cursor
      cursor += length
      if (from >= segmentStart && from <= cursor) {
        const offset =
          segment.fromRunId === null
            ? 0
            : segment.fromOffset + (from - segmentStart)
        sliced.push({
          fromRunId: segment.fromRunId,
          fromOffset: offset,
          toOffset: offset,
        })
        break
      }
    }
  }
  return sliced
}

/**
 * Assigns segments to the parts a split produced. `parts` carry their range in
 * the run's current text. A replaced run cannot be partitioned, so every part
 * inherits the coarse origin set.
 */
export function recordSplitRun(
  recorder: LineageRecorder,
  parent: DocumentTextRunWire,
  parts: ReadonlyArray<{ run: DocumentTextRunWire; from: number; to: number }>,
) {
  const origins = recorder.runOrigins.get(parent) ?? [
    { fromRunId: parent.id, fromOffset: 0, toOffset: parent.text.length },
  ]
  const replaced = recorder.replacedRuns.has(parent)
  for (const part of parts) {
    recorder.runOrigins.set(
      part.run,
      replaced
        ? origins.map((segment) => ({ ...segment }))
        : sliceRunOrigins(origins, part.from, part.to),
    )
    if (replaced) recorder.replacedRuns.add(part.run)
    seedRunOrigins(recorder, part.run)
  }
}

/**
 * Builds the authoritative lineage from the recorder and the resulting model.
 * Result paragraph ids are the canonical ids that serialization will persist.
 */
export function buildVersionLineage(input: {
  recorder: LineageRecorder
  model: DocumentModelWire
  canonicalParagraphIds: ReadonlyMap<DocumentParagraphWire, string>
  baseVersionId: string
  versionId: string
  /**
   * Whether the result run addresses can be trusted. A tracked save reparses
   * to a different run list than the in-memory model (wrapped in `w:ins` /
   * `w:del`), and run model ids are reallocated by document position on every
   * parse, so a tracked version omits every run address. The client then
   * refuses a run-keyed reversal instead of retargeting a positional id.
   */
  runAddressesReliable?: boolean
}): DocumentVersionLineage {
  const { recorder, canonicalParagraphIds } = input
  const runAddressesReliable = input.runAddressesReliable ?? true
  const paragraphs: DocumentParagraphLineage[] = []

  // Group the tracked-change elements the batch created by the accepted
  // operation that created them. An ins-only group is a tracked paragraph
  // insertion: its content lives inside `w:ins`, so rejecting the group empties
  // the paragraph and the same decision must remove the shell.
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

  for (const story of input.model.stories) {
    // The main story is the editable one. Its paragraphs are all part of the
    // map, untouched ones included, so a run that only shifted position when
    // an earlier paragraph was inserted or split still has a result address.
    const wholeStory = story.kind === 'document'
    for (const paragraph of story.paragraphs) {
      const origin = recorder.paragraphOrigin.get(paragraph)
      const toParagraphId = canonicalParagraphIds.get(paragraph) ?? paragraph.id
      // A paragraph the batch touched, or one whose persisted id changed when
      // the version was canonicalised, is part of the base-to-result map. The
      // canonicalised-but-untouched entries are what let a restore anchor on a
      // legacy paragraph resolve to its renamed result id. Outside the main
      // story only those are useful, so the rest are omitted.
      const renamed = toParagraphId !== paragraph.id
      if (!wholeStory && !origin && !renamed) continue
      const runs: DocumentLineageRun[] = runAddressesReliable
        ? paragraph.runs.map((run, runIndex) => ({
            runIndex,
            segments: recorder.runOrigins.get(run) ?? [
              { fromRunId: run.id, fromOffset: 0, toOffset: run.text.length },
            ],
          }))
        : []
      const trackedInsertChangeIds = insertionChangeIds.get(paragraph.id)
      paragraphs.push({
        fromParagraphId: origin ? origin.fromParagraphId : paragraph.id,
        toParagraphId,
        ...(origin?.insertedByOperation !== undefined
          ? { insertedByOperation: origin.insertedByOperation }
          : {}),
        ...(origin?.insertedByIntent
          ? { insertedByIntent: origin.insertedByIntent }
          : {}),
        ...(trackedInsertChangeIds ? { trackedInsertChangeIds } : {}),
        runs,
      })
    }
  }

  for (const [fromParagraphId] of recorder.deletedParagraphs) {
    if (paragraphs.some((item) => item.fromParagraphId === fromParagraphId)) {
      continue
    }
    paragraphs.push({
      fromParagraphId,
      toParagraphId: null,
      runs: [],
    })
  }

  // A tracked operation's reversal is a rejection of the persisted `w:id`s it
  // created, grouped by the accepted operation so a replacement's `del`/`ins`
  // pair is handled as one unit. An insertion that created only an `ins` and
  // no paragraph is a run insertion into an existing paragraph; removing the
  // paragraph is not part of its reversal. A tracked paragraph insertion is
  // carried on its paragraph entry (`trackedInsertChangeIds`), so its shell can
  // be removed in the same decision.
  const reversals: DocumentLineageReversal[] = []
  for (const [operation, group] of [...byOperation.entries()].sort(
    (left, right) => left[0] - right[0],
  )) {
    if (group.every((change) => change.elementName === 'ins')) continue
    const first = group[0]
    if (!first) continue
    reversals.push({
      operation,
      fromRunId: first.fromRunId,
      fromParagraphId: first.fromParagraphId,
      rejectOoxmlIds: [...new Set(group.map((change) => change.ooxmlId))],
    })
  }

  return {
    version: 1,
    baseVersionId: input.baseVersionId,
    versionId: input.versionId,
    acceptedOperations: [...recorder.accepted].sort((a, b) => a - b),
    paragraphs,
    ...(reversals.length > 0 ? { reversals } : {}),
  }
}

/**
 * Re-expresses a lineage recorded against the *current* version as one whose
 * base side is the *client's* base version. A reconciled collaboration merge
 * applies the client's operations to a newer current version, so the recorder
 * names current runs and paragraphs. The caller supplies the current-to-base
 * correspondence computed from the two parsed versions (persisted paragraph
 * ids, then run skeleton), and never a positional or text guess.
 *
 * Content that exists only in the current version (a collaborator's paragraph
 * or run within a touched paragraph) has no base origin, so it is dropped from
 * the map rather than claimed as the client's. The client's covered slots
 * never reference it: the merge refuses an operation that conflicts with it.
 */
export function retargetLineageToBaseVersion(input: {
  lineage: DocumentVersionLineage
  currentToBaseParagraph: ReadonlyMap<string, string>
  currentToBaseRun: ReadonlyMap<string, string>
  baseVersionId: string
}): DocumentVersionLineage {
  const { currentToBaseParagraph, currentToBaseRun } = input
  const paragraphs: DocumentParagraphLineage[] = []
  for (const entry of input.lineage.paragraphs) {
    const entryFromParagraphId = entry.fromParagraphId
    const insertedByThisBatch = entryFromParagraphId === null
    const mappedFromParagraphId =
      entryFromParagraphId === null
        ? null
        : currentToBaseParagraph.get(entryFromParagraphId)
    if (!insertedByThisBatch && mappedFromParagraphId === undefined) {
      continue
    }
    const runs: DocumentLineageRun[] = []
    for (const run of entry.runs) {
      const segments: DocumentLineageSegment[] = []
      for (const segment of run.segments) {
        if (segment.fromRunId === null) {
          segments.push(segment)
          continue
        }
        const baseRunId = currentToBaseRun.get(segment.fromRunId)
        if (baseRunId) segments.push({ ...segment, fromRunId: baseRunId })
      }
      if (segments.length > 0) runs.push({ runIndex: run.runIndex, segments })
    }
    paragraphs.push({
      ...entry,
      fromParagraphId: mappedFromParagraphId ?? null,
      runs,
    })
  }

  const reversals = input.lineage.reversals?.flatMap((reversal) => {
    const fromRunId = reversal.fromRunId
      ? (currentToBaseRun.get(reversal.fromRunId) ?? null)
      : null
    const fromParagraphId = reversal.fromParagraphId
      ? (currentToBaseParagraph.get(reversal.fromParagraphId) ?? null)
      : null
    // A reversal whose addresses do not exist in the base cannot be offered to
    // the client; the boundary then blocks honestly rather than retargeting.
    if (reversal.fromRunId && !fromRunId) return []
    if (reversal.fromParagraphId && !fromParagraphId) return []
    return [
      {
        ...reversal,
        fromRunId,
        fromParagraphId,
      },
    ]
  })

  return {
    ...input.lineage,
    baseVersionId: input.baseVersionId,
    paragraphs,
    ...(reversals && reversals.length > 0 ? { reversals } : {}),
  }
}
