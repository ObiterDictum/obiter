import { editableParagraphs } from './document-model-text'
import {
  isPendingBaselineId,
  PENDING_BASELINE_PREFIX,
  type DraftState,
} from './document-save-plan'
import type { SaveBaseline } from './document-baseline-identity-keys'
import {
  parsePendingRunAddress,
  paragraphMapFromLineage,
  pendingRunAddressId,
  remapRecordKeys,
  savedIdentities,
} from './document-baseline-identity-keys'
import { reversalRunTexts, storyParagraph } from './document-baseline-lineage'

export function remapLiveDraftState(state: DraftState, baseline: SaveBaseline) {
  const toModel = baseline.toModel
  if (!toModel) return { state, unresolved: false }
  const identities = savedIdentities(baseline)
  const paragraphMap = baseline.lineage
    ? paragraphMapFromLineage(baseline.lineage)
    : new Map<string, string>()
  const remapParagraph = (id: string) => paragraphMap.get(id) ?? id
  const fromRunIds = new Set(
    editableParagraphs(baseline.fromModel).flatMap((paragraph) =>
      paragraph.runs.map((run) => run.id),
    ),
  )
  let unresolved = false

  const drafts: Record<string, string> = {}
  for (const [key, value] of Object.entries(state.drafts)) {
    if (isPendingBaselineId(key)) {
      drafts[key] = value
      continue
    }
    // A draft that raced a save which split its run still names the run's
    // whole text, so it distributes across the continuing parts the same way
    // a reversal does — writing it to the first alone would duplicate the
    // tail's saved text beside it.
    if (identities.runContinuations.get(key)?.length) {
      for (const [targetRunId, text] of reversalRunTexts(
        identities,
        key,
        value,
      )) {
        drafts[targetRunId] = text
      }
      continue
    }
    if (fromRunIds.has(key)) unresolved = true
    drafts[key] = value
  }

  const emphasis = state.format.emphasis.flatMap((item) => {
    if (item.runId) {
      const continuations = identities.runContinuations.get(item.runId)
      if (continuations?.length) {
        // A run the save split inherits the pending styling on every part.
        return continuations.map((continuation) => ({
          ...item,
          runId:
            continuation.runId ?? pendingRunAddressId(continuation.address),
        }))
      }
      if (fromRunIds.has(item.runId)) unresolved = true
    }
    return [
      item.paragraphId
        ? { ...item, paragraphId: remapParagraph(item.paragraphId) }
        : item,
    ]
  })

  const remapped: DraftState = {
    ...state,
    drafts,
    inserts: state.inserts.map((insert) => ({
      ...insert,
      afterParagraphId: remapParagraph(insert.afterParagraphId),
      ...(insert.beforeParagraphId
        ? { beforeParagraphId: remapParagraph(insert.beforeParagraphId) }
        : {}),
    })),
    deletedParagraphIds: state.deletedParagraphIds.map(remapParagraph),
    extraRuns: remapRecordKeys(state.extraRuns, remapParagraph),
    breaks: state.breaks.map((item) => ({
      ...item,
      paragraphId: remapParagraph(item.paragraphId),
    })),
    format: {
      ...state.format,
      paragraphStyles: remapRecordKeys(
        state.format.paragraphStyles,
        remapParagraph,
      ),
      numbering: remapRecordKeys(state.format.numbering, remapParagraph),
      paragraphFormats: remapRecordKeys(
        state.format.paragraphFormats,
        remapParagraph,
      ),
      emphasis,
    },
  }
  const resolved = resolveBaselineIdentities(remapped, baseline)
  return {
    state: resolved,
    unresolved: unresolved || hasUnresolvedBaselineIdentities(resolved),
  }
}

/**
 * Whether a boundary carries the authoritative lineage it needs to translate
 * safely. A response without one must be surfaced, never guessed around.
 */

export function resolveBaselineIdentities(
  state: DraftState,
  baseline: SaveBaseline,
): DraftState {
  const toModel = baseline.toModel
  if (!toModel) return state
  const identities = savedIdentities(baseline)
  const drafts: Record<string, string> = {}
  for (const [key, value] of Object.entries(state.drafts)) {
    if (!isPendingBaselineId(key)) {
      drafts[key] = value
      continue
    }
    const address = parsePendingRunAddress(key)
    const addressed = address
      ? storyParagraph(toModel, address.paragraphId)?.runs[address.runIndex]?.id
      : undefined
    if (addressed) {
      drafts[addressed] = value
      continue
    }
    if (key.startsWith(`${PENDING_BASELINE_PREFIX}run:`)) {
      const clientId = key.slice(`${PENDING_BASELINE_PREFIX}run:`.length)
      const runId = identities.insertedRuns.get(clientId)
      if (runId) {
        drafts[runId] = value
        continue
      }
    }
    drafts[key] = value
  }
  const deletedParagraphIds: string[] = []
  for (const id of state.deletedParagraphIds) {
    if (!isPendingBaselineId(id)) {
      deletedParagraphIds.push(id)
      continue
    }
    if (id.startsWith(`${PENDING_BASELINE_PREFIX}delete:`)) {
      const clientId = id.slice(`${PENDING_BASELINE_PREFIX}delete:`.length)
      const paragraphId = identities.inserted.get(clientId)
      if (paragraphId) {
        deletedParagraphIds.push(paragraphId)
        continue
      }
    }
    deletedParagraphIds.push(id)
  }
  const emphasis = state.format.emphasis.map((item) => {
    if (!item.runId || !isPendingBaselineId(item.runId)) return item
    const address = parsePendingRunAddress(item.runId)
    const runId = address
      ? storyParagraph(toModel, address.paragraphId)?.runs[address.runIndex]?.id
      : undefined
    return runId ? { ...item, runId } : item
  })
  return {
    ...state,
    drafts,
    deletedParagraphIds,
    format: { ...state.format, emphasis },
  }
}

/**
 * Whether any identity the boundary introduced is still without a result
 * address. The caller must treat that as a blocked boundary, not as saved work.
 */
export function hasUnresolvedBaselineIdentities(state: DraftState): boolean {
  return (
    Object.keys(state.drafts).some(isPendingBaselineId) ||
    state.deletedParagraphIds.some(isPendingBaselineId) ||
    state.format.emphasis.some(
      (item) => item.runId !== undefined && isPendingBaselineId(item.runId),
    )
  )
}
