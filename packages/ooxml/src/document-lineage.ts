import { buildTrackedReversals } from './document-lineage-reversals'
import type {
  DocumentLineageSegment,
  DocumentLineageRun,
  DocumentModelWire,
  DocumentParagraphLineage,
  DocumentParagraphWire,
  DocumentTextRunWire,
  DocumentVersionLineage,
} from '@obiter/contracts'

export type LineageRecorder = {
  accepted: number[]
  baseRunLengths: Map<string, number>
  runOrigins: Map<DocumentTextRunWire, DocumentLineageSegment[]>
  replacedRuns: WeakSet<DocumentTextRunWire>
  paragraphOrigin: Map<
    DocumentParagraphWire,
    {
      fromParagraphId: string | null
      insertedByOperation?: number
      insertedByIntent?: string
    }
  >
  deletedParagraphs: Map<string, { insertedByOperation?: number }>
  touched: Set<DocumentParagraphWire>
  trackedChanges: RecordedTrackedChange[]
}

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

export function dropTrackedChanges(
  recorder: LineageRecorder,
  ooxmlIds: readonly string[],
) {
  if (ooxmlIds.length === 0) return
  const consumed = new Set(ooxmlIds)
  recorder.trackedChanges = recorder.trackedChanges.filter(
    (change) => !consumed.has(change.ooxmlId),
  )
}

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

export function recordReplacedRun(
  recorder: LineageRecorder,
  run: DocumentTextRunWire,
) {
  recorder.replacedRuns.add(run)
  seedRunOrigins(recorder, run)
  const length = run.text.length
  recorder.runOrigins.set(
    run,
    (recorder.runOrigins.get(run) ?? []).map((segment) =>
      segment.fromRunId === null
        ? { fromRunId: null, fromOffset: 0, toOffset: 0 }
        : { fromRunId: segment.fromRunId, fromOffset: 0, toOffset: length },
    ),
  )
}

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

function sliceReplacedRunOrigins(
  origins: readonly DocumentLineageSegment[],
  parentLength: number,
  part: { from: number; to: number },
): DocumentLineageSegment[] {
  return origins.map((segment) => {
    if (segment.fromRunId === null) {
      return { fromRunId: null, fromOffset: 0, toOffset: 0 }
    }
    return segment.toOffset - segment.fromOffset === parentLength
      ? {
          fromRunId: segment.fromRunId,
          fromOffset: segment.fromOffset + part.from,
          toOffset: segment.fromOffset + part.to,
        }
      : {
          fromRunId: segment.fromRunId,
          fromOffset: part.from,
          toOffset: part.to,
        }
  })
}

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
        ? sliceReplacedRunOrigins(origins, parent.text.length, part)
        : sliceRunOrigins(origins, part.from, part.to),
    )
    if (replaced) recorder.replacedRuns.add(part.run)
    seedRunOrigins(recorder, part.run)
  }
}

export function buildVersionLineage(input: {
  recorder: LineageRecorder
  model: DocumentModelWire
  canonicalParagraphIds: ReadonlyMap<DocumentParagraphWire, string>
  baseVersionId: string
  versionId: string
  runAddressesReliable?: boolean
}): DocumentVersionLineage {
  const { recorder, canonicalParagraphIds } = input
  const runAddressesReliable = input.runAddressesReliable ?? true
  const paragraphs: DocumentParagraphLineage[] = []
  const { insertionChangeIds, reversals } = buildTrackedReversals(recorder)

  for (const story of input.model.stories) {
    const wholeStory = story.kind === 'document'
    for (const paragraph of story.paragraphs) {
      const origin = recorder.paragraphOrigin.get(paragraph)
      const toParagraphId = canonicalParagraphIds.get(paragraph) ?? paragraph.id
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

  return {
    version: 1,
    baseVersionId: input.baseVersionId,
    versionId: input.versionId,
    acceptedOperations: [...recorder.accepted].sort((a, b) => a - b),
    paragraphs,
    ...(reversals.length > 0 ? { reversals } : {}),
  }
}

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
