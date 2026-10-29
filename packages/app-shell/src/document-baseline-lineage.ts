import type {
  DocumentModelWire,
  DocumentVersionLineage,
} from '@obiter/contracts'
import { storyFlowParagraphIds } from './document-edits'
import {
  editableParagraph,
  editableParagraphs,
  editableStoryOf,
} from './document-model-text'
import { emphasisSlotKey, type DraftSlot } from './document-save-plan'
import type {
  SaveBaseline,
  SavedIdentities,
  RunContinuation,
} from './document-baseline-identity-keys'
import {
  sentInsertRunIds,
  pendingRunAddressId,
  pendingUnresolvedRunId,
} from './document-baseline-identity-keys'

function coveredRunIds(
  slot: DraftSlot,
  baseline: Pick<SaveBaseline, 'sent' | 'fromModel'>,
): string[] {
  switch (slot.kind) {
    case 'run-text':
      return [slot.runId]
    case 'extra-runs': {
      const last = storyParagraph(
        baseline.fromModel,
        slot.paragraphId,
      )?.runs.at(-1)
      return last ? [last.id] : []
    }
    case 'emphasis': {
      const sent = baseline.sent.format.emphasis.find(
        (item) => emphasisSlotKey(item) === slot.key,
      )
      return sent?.runId ? [sent.runId] : []
    }
    default:
      return []
  }
}

export function lineageCoversCoveredSlots(
  lineage: DocumentVersionLineage,
  baseline: Pick<SaveBaseline, 'covered' | 'sent' | 'fromModel'>,
): boolean {
  const runAddresses = new Set<string>()
  const paragraphIds = new Set<string>()
  for (const entry of lineage.paragraphs) {
    if (entry.fromParagraphId) paragraphIds.add(entry.fromParagraphId)
    for (const run of entry.runs) {
      for (const segment of run.segments) {
        if (segment.fromRunId) runAddresses.add(segment.fromRunId)
      }
    }
  }
  const reversedRuns = new Set(
    (lineage.reversals ?? []).flatMap((reversal) =>
      reversal.fromRunId ? [reversal.fromRunId] : [],
    ),
  )
  const reversedParagraphs = new Set(
    (lineage.reversals ?? []).flatMap((reversal) =>
      reversal.fromParagraphId ? [reversal.fromParagraphId] : [],
    ),
  )
  const insertedRunIds = sentInsertRunIds(baseline)
  for (const slot of baseline.covered) {
    if (slot.kind === 'insert') {
      const entry = lineage.paragraphs.find(
        (paragraph) => paragraph.insertedByIntent === slot.clientId,
      )
      if (!entry) return false
      if (entry.trackedInsertChangeIds?.length && entry.toParagraphId) {
        continue
      }
      if (entry.runs.length === 0) return false
      continue
    }
    if (slot.kind === 'delete') {
      if (reversedParagraphs.has(slot.paragraphId)) continue
      if (
        !lineage.paragraphs.some(
          (entry) => entry.fromParagraphId === slot.paragraphId,
        )
      ) {
        return false
      }
      continue
    }
    if (
      slot.kind === 'paragraph-style' ||
      slot.kind === 'numbering' ||
      slot.kind === 'paragraph-format'
    ) {
      if (reversedParagraphs.has(slot.paragraphId)) continue
      if (paragraphIds.has(slot.paragraphId)) continue
      if (
        lineage.paragraphs.some(
          (entry) => entry.insertedByIntent === slot.paragraphId,
        )
      ) {
        continue
      }
      return false
    }
    if (slot.kind === 'emphasis') {
      const sent = baseline.sent.format.emphasis.find(
        (item) => emphasisSlotKey(item) === slot.key,
      )
      if (sent?.runId) {
        if (!runAddresses.has(sent.runId) && !reversedRuns.has(sent.runId)) {
          return false
        }
      } else if (
        sent?.paragraphId &&
        !paragraphIds.has(sent.paragraphId) &&
        !reversedParagraphs.has(sent.paragraphId)
      ) {
        return false
      }
      continue
    }
    for (const runId of coveredRunIds(slot, baseline)) {
      if (
        !runAddresses.has(runId) &&
        !reversedRuns.has(runId) &&
        !insertedRunIds.has(runId)
      ) {
        return false
      }
    }
  }
  return true
}

export function lineageIdentities(
  lineage: DocumentVersionLineage,
  toModel: DocumentModelWire | undefined,
  baseline: SaveBaseline,
): SavedIdentities {
  const inserted = new Map<string, string>()
  const insertedRuns = new Map<string, string>()
  const restoredAnchors = new Map<string, string>()
  const restoredBeforeAnchors = new Map<string, string>()
  const paragraphIds = new Map<string, string>()
  const runContinuations = new Map<string, RunContinuation[]>()

  for (const entry of lineage.paragraphs) {
    if (entry.fromParagraphId && entry.toParagraphId) {
      paragraphIds.set(entry.fromParagraphId, entry.toParagraphId)
    }
    if (!entry.toParagraphId) continue
    const paragraph = toModel
      ? storyParagraph(toModel, entry.toParagraphId)
      : undefined
    for (const run of entry.runs) {
      const spans = new Map<string, { from: number; to: number }>()
      for (const segment of run.segments) {
        if (segment.fromRunId === null) continue
        const span = spans.get(segment.fromRunId)
        if (span) {
          span.from = Math.min(span.from, segment.fromOffset)
          span.to = Math.max(span.to, segment.toOffset)
        } else {
          spans.set(segment.fromRunId, {
            from: segment.fromOffset,
            to: segment.toOffset,
          })
        }
      }
      for (const [fromRunId, span] of spans) {
        const continuations = runContinuations.get(fromRunId) ?? []
        continuations.push({
          address: {
            paragraphId: entry.toParagraphId,
            runIndex: run.runIndex,
          },
          runId: paragraph?.runs[run.runIndex]?.id,
          ...span,
        })
        runContinuations.set(fromRunId, continuations)
      }
    }
  }

  for (const entry of lineage.paragraphs) {
    if (entry.fromParagraphId !== null) continue
    const intentId = entry.insertedByIntent
    if (!intentId || !entry.toParagraphId) continue
    inserted.set(intentId, entry.toParagraphId)
    if (!toModel) continue
    const run = storyParagraph(toModel, entry.toParagraphId)?.runs[0]
    if (run) insertedRuns.set(intentId, run.id)
  }

  const deleted = new Set(
    baseline.covered.flatMap((slot) =>
      slot.kind === 'delete' ? [slot.paragraphId] : [],
    ),
  )
  for (const slot of baseline.covered) {
    if (slot.kind !== 'delete') continue
    const fromOrder = storyFlowParagraphIds(
      editableStoryOf(baseline.fromModel, slot.paragraphId),
      [],
      [],
    )
    const surviving = new Set(fromOrder.filter((id) => !deleted.has(id)))
    const anchor = nearestSurvivingPreceding(
      fromOrder,
      surviving,
      slot.paragraphId,
    )
    if (anchor) {
      restoredAnchors.set(slot.paragraphId, paragraphIds.get(anchor) ?? anchor)
      continue
    }
    const next = nearestSurvivingFollowing(
      fromOrder,
      surviving,
      slot.paragraphId,
    )
    if (next) {
      restoredBeforeAnchors.set(
        slot.paragraphId,
        paragraphIds.get(next) ?? next,
      )
    }
  }

  const runReversals = new Map<string, string[]>()
  const paragraphReversals = new Map<string, string[]>()
  for (const reversal of lineage.reversals ?? []) {
    if (reversal.fromRunId) {
      runReversals.set(reversal.fromRunId, [
        ...(runReversals.get(reversal.fromRunId) ?? []),
        ...reversal.rejectOoxmlIds,
      ])
    } else if (reversal.fromParagraphId) {
      paragraphReversals.set(reversal.fromParagraphId, [
        ...(paragraphReversals.get(reversal.fromParagraphId) ?? []),
        ...reversal.rejectOoxmlIds,
      ])
    }
  }

  const insertReversals = new Map<
    string,
    { ooxmlIds: string[]; removeParagraphId: string }
  >()
  for (const entry of lineage.paragraphs) {
    if (
      !entry.insertedByIntent ||
      !entry.toParagraphId ||
      !entry.trackedInsertChangeIds?.length
    ) {
      continue
    }
    insertReversals.set(entry.insertedByIntent, {
      ooxmlIds: [...entry.trackedInsertChangeIds],
      removeParagraphId: entry.toParagraphId,
    })
  }

  return {
    inserted,
    insertedRuns,
    restoredAnchors,
    restoredBeforeAnchors,
    paragraphIds,
    runContinuations,
    runReversals,
    paragraphReversals,
    insertReversals,
  }
}

function nearestSurvivingPreceding(
  order: readonly string[],
  surviving: ReadonlySet<string>,
  paragraphId: string,
) {
  const index = order.indexOf(paragraphId)
  if (index <= 0) return null
  for (let at = index - 1; at >= 0; at -= 1) {
    const id = order[at]
    if (id && surviving.has(id)) return id
  }
  return null
}

function nearestSurvivingFollowing(
  order: readonly string[],
  surviving: ReadonlySet<string>,
  paragraphId: string,
) {
  const index = order.indexOf(paragraphId)
  if (index < 0) return null
  for (let at = index + 1; at < order.length; at += 1) {
    const id = order[at]
    if (id && surviving.has(id)) return id
  }
  return null
}

export function storyParagraph(model: DocumentModelWire, paragraphId: string) {
  return editableParagraph(model, paragraphId)
}

export function runText(model: DocumentModelWire, runId: string) {
  for (const paragraph of editableParagraphs(model)) {
    for (const run of paragraph.runs) {
      if (run.id === runId) return run.text
    }
  }
  return undefined
}

export function reversalRunTexts(
  identities: SavedIdentities,
  baseRunId: string,
  text: string,
): [string, string][] {
  const continuations = identities.runContinuations.get(baseRunId)
  if (!continuations || continuations.length === 0) {
    return [[pendingUnresolvedRunId(baseRunId), text]]
  }
  return continuations.map((continuation, index): [string, string] => {
    const from = index === 0 ? 0 : continuation.from
    const value =
      index === continuations.length - 1
        ? text.slice(from)
        : text.slice(from, continuation.to)
    return [
      continuation.runId ?? pendingRunAddressId(continuation.address),
      value,
    ]
  })
}
