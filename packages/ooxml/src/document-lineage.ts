import type {
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
    { fromParagraphId: string | null; insertedByOperation?: number }
  >
  /** Base paragraphs deleted by the batch, keyed by base paragraph id. */
  deletedParagraphs: Map<string, { insertedByOperation?: number }>
  /** Paragraphs this batch touched, in insertion order. */
  touched: Set<DocumentParagraphWire>
}

export function createLineageRecorder(model: DocumentModelWire): LineageRecorder {
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
) {
  recorder.touched.add(paragraph)
  recorder.paragraphOrigin.set(paragraph, {
    fromParagraphId: null,
    insertedByOperation: operationIndex,
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
      replaced ? origins.map((segment) => ({ ...segment })) : sliceRunOrigins(origins, part.from, part.to),
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
}): DocumentVersionLineage {
  const { recorder, canonicalParagraphIds } = input
  const paragraphs: DocumentParagraphLineage[] = []

  for (const story of input.model.stories) {
    for (const paragraph of story.paragraphs) {
      const origin = recorder.paragraphOrigin.get(paragraph)
      if (!origin) continue
      const toParagraphId =
        canonicalParagraphIds.get(paragraph) ?? paragraph.id
      const runs: DocumentLineageRun[] = paragraph.runs.map((run, runIndex) => ({
        runIndex,
        segments: recorder.runOrigins.get(run) ?? [
          { fromRunId: run.id, fromOffset: 0, toOffset: run.text.length },
        ],
      }))
      paragraphs.push({
        fromParagraphId: origin.fromParagraphId,
        toParagraphId,
        ...(origin.insertedByOperation !== undefined
          ? { insertedByOperation: origin.insertedByOperation }
          : {}),
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

  return {
    version: 1,
    baseVersionId: input.baseVersionId,
    versionId: input.versionId,
    acceptedOperations: [...recorder.accepted].sort((a, b) => a - b),
    paragraphs,
  }
}
