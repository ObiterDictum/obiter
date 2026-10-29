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

export function hasAuthoritativeLineage(baseline: SaveBaseline): boolean {
  return baseline.lineage !== undefined && baseline.versionId !== undefined
}

/**
 * The base runs a covered reversal has to be able to address. A missing
 * address is what makes a translation unsafe: the result model run ids are
 * positional, so falling back to the base id can name unrelated content.
 */
export function coveredRunIds(
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

/**
 * Whether the lineage names every covered slot the translation needs. A
 * response that omits one is incomplete, so the caller must not translate it:
 * a positional fallback would retarget the reversal at unrelated content. A
 * tracked version carries no run addresses at all (the reparsed run list
 * differs), so any run-keyed covered slot is refused and surfaced as blocked.
 */
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
  // A tracked operation has no result run address; its reversal is the
  // rejection group the lineage carries. A run on a paragraph the same batch
  // inserted is covered by that insert's deletion, so it needs no address.
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
      // A tracked insertion carries its own reversal: rejecting the `w:ins`
      // ids and removing the shell paragraph in one decision. Its result
      // paragraph has no run address, but that does not make it uncoverable.
      if (entry.trackedInsertChangeIds?.length && entry.toParagraphId) {
        continue
      }
      // An untracked insertion's result paragraph must carry a run; a tracked
      // insertion with no reversal recorded is a boundary that cannot be
      // reconciled, and is surfaced rather than guessed.
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
      // A style on a paragraph the same batch inserted is addressed by the
      // insert's intent id; every other paragraph must be in the map.
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

/**
 * Reads identity from the server's authoritative lineage. A base run may map
 * to several result runs (a split) or a result run may compose several base
 * runs (a merge); the lineage's own segments name every continuing result
 * run with the slice of the base run's text it carries, and a paragraph maps
 * directly.
 */
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
      // One continuing run may owe several segments to the same base run (a
      // move or re-join); its slice of the base run's saved text is the span
      // they cover together.
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

  // Insertions are correlated by the opaque intent id the client sent, never
  // by matching the insert lists. An inserted paragraph without one (an
  // empty-paragraph fill) has no client insert slot to name.
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
    // The restoration anchor is found inside the deleted paragraph's own
    // story: a header paragraph restores against its header siblings.
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
    // A deletion that removed the first paragraph has no preceding anchor; it
    // re-inserts before the first survivor instead, so the reversal is never
    // silently dropped.
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
    // Two operations in one batch can name the same node — a text edit and a
    // property change on one run both record a reversal keyed by it — so ids
    // merge into the node's group rather than the later op overwriting the
    // earlier and leaving ids the undo group can never reject.
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

  // A tracked paragraph insertion carries its own reversal: rejecting the
  // `w:ins` ids empties the paragraph, and removing the shell named by the
  // result paragraph id completes the undo in the same decision.
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

export function nearestSurvivingPreceding(
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

export function nearestSurvivingFollowing(
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

/**
 * Re-expresses a pre-save run text across every result run that continues the
 * base run: a mid-run splice left the head of the text in the first result
 * run and the tail in the last, so each takes the slice at its own recorded
 * range — writing the whole text to the first alone would leave the tail's
 * saved text beside the restored head, and the next save persists that
 * duplication. The first also takes anything before its range and the last
 * anything after it, so no character the snapshot held is dropped. A run the
 * lineage does not continue keeps the whole text at a pending identity that
 * stays unresolved — and blocks — if no result run can be named for it.
 */
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
