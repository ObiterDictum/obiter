import type {
  DocumentModelWire,
  DocumentVersionLineage,
} from '@obiter/contracts'
import {
  flowParagraphIds,
  insertPlainText,
  removeInsert,
  runPropertiesFromFragments,
  type LocalInsert,
} from './document-edits'
import { mergeEmphasis, paragraphNumPr } from './document-format-edits'
import { paragraphFormatOf } from './document-paragraph-format'
import type {
  ParagraphFormatDraft,
  PendingEmphasis,
} from './document-format-types'
import { documentStory } from './document-model-text'
import {
  emphasisSlotKey,
  isPendingBaselineId,
  PENDING_BASELINE_PREFIX,
  removeDraftSlots,
  type DraftSlot,
  type DraftState,
} from './document-save-plan'

/**
 * The relationship between the history snapshots and the saved document.
 *
 * A history snapshot is a `DraftState` measured against the loaded model. A
 * successful save commits the covered slots and advances the model, so every
 * snapshot taken while those slots were live now describes the old baseline:
 * replaying it would reintroduce work the server already stored, and the next
 * save would resend it. `translateSnapshot` re-expresses a snapshot against the
 * saved baseline so undo still reverses the saved edit, while the slots it
 * covered can never be replayed as fresh operations.
 *
 * A save boundary is the one record of that relationship. It is produced by
 * `useDocumentSave` at the commit choke point and consumed by the draft hook,
 * which owns the only history stacks. There is no second baseline.
 */
export type SaveBaseline = {
  /** Slots the successful request covered, in plan order. */
  covered: readonly DraftSlot[]
  /** The draft state the request was planned from. */
  sent: DraftState
  /** The model the snapshots were recorded against. */
  fromModel: DocumentModelWire
  /**
   * The authoritative lineage the server returned for the accepted batch. When
   * present, identity is read from it rather than inferred from a diff.
   */
  lineage?: DocumentVersionLineage
  /** The result version the lineage describes. */
  versionId?: string
  /** The monotonic number of that version, for provenance against a reload. */
  versionNumber?: number
  /**
   * The saved model, once the workspace has it. Absent between the commit and
   * the reloaded `/model` response, when an identity can only be a placeholder.
   */
  toModel?: DocumentModelWire
}

// A saved insert becomes a stored paragraph with a server-allocated id, and a
// saved delete removes one. Until the reloaded model names them, the reversal
// is held as a placeholder: the planner never sends or blocks it, and the
// boundary resolves it to a real id as soon as the model arrives. One prefix
// (`document-save-plan.ts`) marks the one concept, whether it addresses a
// deleted paragraph or a run of a restored one.

function pendingDeleteId(clientId: string) {
  return `${PENDING_BASELINE_PREFIX}delete:${clientId}`
}

function pendingRunId(clientId: string) {
  return `${PENDING_BASELINE_PREFIX}run:${clientId}`
}

function pendingDeletedParagraphId(paragraphId: string) {
  return `${PENDING_BASELINE_PREFIX}restore:${paragraphId}`
}

/**
 * The result address of a base run: the persisted paragraph it continues and
 * its index in that paragraph's run list. This is the lineage's own result
 * address; the model run id (`text-NNNNNN`) is positional and only knowable
 * once the reloaded model is in hand.
 */
type RunAddress = { paragraphId: string; runIndex: number }

function pendingRunAddressId(address: RunAddress) {
  return `${PENDING_BASELINE_PREFIX}run-address:${address.paragraphId}:${String(address.runIndex)}`
}

/** A covered run the lineage never names. It is never sent; it stays pending. */
function pendingUnresolvedRunId(baseRunId: string) {
  return `${PENDING_BASELINE_PREFIX}run-unresolved:${baseRunId}`
}

function parsePendingRunAddress(key: string): RunAddress | null {
  const prefix = `${PENDING_BASELINE_PREFIX}run-address:`
  if (!key.startsWith(prefix)) return null
  const rest = key.slice(prefix.length)
  const at = rest.lastIndexOf(':')
  if (at <= 0) return null
  const paragraphId = rest.slice(0, at)
  const runIndex = Number(rest.slice(at + 1))
  if (!Number.isInteger(runIndex) || runIndex < 0) return null
  return { paragraphId, runIndex }
}

type SavedIdentities = {
  /** Covered insert clientId -> the stored paragraph it became. */
  inserted: Map<string, string>
  /** Covered insert clientId -> the stored paragraph's first run. */
  insertedRuns: Map<string, string>
  /** Covered deleted paragraphId -> the surviving paragraph it re-inserts after. */
  restoredAnchors: Map<string, string>
  /**
   * Covered deleted paragraphId -> the surviving paragraph it re-inserts
   * before, when the deletion removed the first paragraph and no preceding
   * anchor survives.
   */
  restoredBeforeAnchors: Map<string, string>
  /** Base paragraph id -> result paragraph id (authoritative lineage only). */
  paragraphIds: Map<string, string>
  /**
   * Base run id -> its result address in the lineage. This is available as
   * soon as the lineage is, before the reloaded model names the run.
   */
  runAddresses: Map<string, RunAddress>
  /** Base run id -> the result run model id (only once the model is loaded). */
  runIds: Map<string, string>
  /**
   * Base run id -> persisted change ids whose rejection reverses a tracked
   * operation on it. A tracked text replacement removes its run from the
   * reparsed model, so this is the only identity its reversal can use.
   */
  runReversals: Map<string, string[]>
  /** Base paragraph id -> persisted change ids whose rejection reverses it. */
  paragraphReversals: Map<string, string[]>
  /**
   * Insert clientId -> the tracked insertion's reversal. The content lives in
   * `w:ins`, so rejecting its change ids restores the pre-insertion content and
   * the shell paragraph is removed in the same decision.
   */
  insertReversals: Map<
    string,
    { ooxmlIds: string[]; removeParagraphId: string }
  >
}

/**
 * Identity comes only from the server's authoritative lineage. A response
 * without one is not permission to guess: `useSaveBaseline` treats it as an
 * unresolved boundary and refuses to translate or save. There is deliberately
 * no set-difference fallback, because after a mid-document insert it names an
 * unrelated paragraph and a reversal can delete it.
 */
function savedIdentities(baseline: SaveBaseline): SavedIdentities {
  if (!baseline.lineage) return emptyIdentities()
  return lineageIdentities(baseline.lineage, baseline.toModel, baseline)
}

function emptyIdentities(): SavedIdentities {
  return {
    inserted: new Map(),
    insertedRuns: new Map(),
    restoredAnchors: new Map(),
    restoredBeforeAnchors: new Map(),
    paragraphIds: new Map(),
    runAddresses: new Map(),
    runIds: new Map(),
    runReversals: new Map(),
    paragraphReversals: new Map(),
    insertReversals: new Map(),
  }
}

/**
 * The base-to-result paragraph map the lineage carries. Used to retarget live
 * draft state and the caret after a save canonicalises paragraph identity.
 */
export function paragraphMapFromLineage(
  lineage: DocumentVersionLineage,
): Map<string, string> {
  return new Map(
    lineage.paragraphs.flatMap((entry) =>
      entry.fromParagraphId && entry.toParagraphId
        ? [[entry.fromParagraphId, entry.toParagraphId] as const]
        : [],
    ),
  )
}

function remapRecordKeys<T>(
  record: Record<string, T>,
  remap: (id: string) => string,
) {
  const next: Record<string, T> = {}
  for (const [key, value] of Object.entries(record)) {
    next[remap(key)] = value
  }
  return next
}

/**
 * Retargets every identifier a live draft state still holds after a save
 * moved it: paragraph ids through the paragraph map, and run-keyed overrides
 * and emphasis through the base-to-result run map. A base run the lineage does
 * not name is surfaced as unresolved, never silently retargeted at whatever
 * run inherited its positional id.
 */
export function remapLiveDraftState(state: DraftState, baseline: SaveBaseline) {
  const toModel = baseline.toModel
  if (!toModel) return { state, unresolved: false }
  const identities = savedIdentities(baseline)
  const paragraphMap = baseline.lineage
    ? paragraphMapFromLineage(baseline.lineage)
    : new Map<string, string>()
  const remapParagraph = (id: string) => paragraphMap.get(id) ?? id
  const fromRunIds = new Set(
    (documentStory(baseline.fromModel)?.paragraphs ?? []).flatMap((paragraph) =>
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
    const mapped = identities.runIds.get(key)
    if (mapped) {
      drafts[mapped] = value
      continue
    }
    if (fromRunIds.has(key)) unresolved = true
    drafts[key] = value
  }

  const emphasis = state.format.emphasis.map((item) => {
    const runId = item.runId ? identities.runIds.get(item.runId) : undefined
    if (runId) return { ...item, runId }
    if (item.runId && fromRunIds.has(item.runId)) unresolved = true
    return item.paragraphId
      ? { ...item, paragraphId: remapParagraph(item.paragraphId) }
      : item
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
export function hasAuthoritativeLineage(baseline: SaveBaseline): boolean {
  return baseline.lineage !== undefined && baseline.versionId !== undefined
}

/**
 * The base runs a covered reversal has to be able to address. A missing
 * address is what makes a translation unsafe: the result model run ids are
 * positional, so falling back to the base id can name unrelated content.
 */
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
  const insertedRunIds = new Set(
    baseline.sent.inserts.flatMap((insert) =>
      (insert.runs ?? []).map((run) => run.id),
    ),
  )
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
 * runs (a merge); the first result run that continues a base run is its
 * address for a reversal, and a paragraph maps directly.
 */
function lineageIdentities(
  lineage: DocumentVersionLineage,
  toModel: DocumentModelWire | undefined,
  baseline: SaveBaseline,
): SavedIdentities {
  const inserted = new Map<string, string>()
  const insertedRuns = new Map<string, string>()
  const restoredAnchors = new Map<string, string>()
  const restoredBeforeAnchors = new Map<string, string>()
  const paragraphIds = new Map<string, string>()
  const runAddresses = new Map<string, RunAddress>()
  const runIds = new Map<string, string>()

  for (const entry of lineage.paragraphs) {
    if (entry.fromParagraphId && entry.toParagraphId) {
      paragraphIds.set(entry.fromParagraphId, entry.toParagraphId)
    }
    if (!entry.toParagraphId) continue
    for (const run of entry.runs) {
      for (const segment of run.segments) {
        if (segment.fromRunId && !runAddresses.has(segment.fromRunId)) {
          runAddresses.set(segment.fromRunId, {
            paragraphId: entry.toParagraphId,
            runIndex: run.runIndex,
          })
        }
      }
    }
    if (!toModel) continue
    const paragraph = storyParagraph(toModel, entry.toParagraphId)
    for (const run of entry.runs) {
      const resultRunId = paragraph?.runs[run.runIndex]?.id
      if (!resultRunId) continue
      for (const segment of run.segments) {
        if (segment.fromRunId && !runIds.has(segment.fromRunId)) {
          runIds.set(segment.fromRunId, resultRunId)
        }
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

  const fromOrder = flowParagraphIds(baseline.fromModel, [], [])
  const deleted = new Set(
    baseline.covered.flatMap((slot) =>
      slot.kind === 'delete' ? [slot.paragraphId] : [],
    ),
  )
  const surviving = new Set(fromOrder.filter((id) => !deleted.has(id)))
  for (const slot of baseline.covered) {
    if (slot.kind !== 'delete') continue
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
    if (reversal.fromRunId) {
      runReversals.set(reversal.fromRunId, [...reversal.rejectOoxmlIds])
    } else if (reversal.fromParagraphId) {
      paragraphReversals.set(reversal.fromParagraphId, [
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
    runAddresses,
    runIds,
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

function storyParagraph(model: DocumentModelWire, paragraphId: string) {
  return documentStory(model)?.paragraphs.find(
    (paragraph) => paragraph.id === paragraphId,
  )
}

function runText(model: DocumentModelWire, runId: string) {
  for (const paragraph of documentStory(model)?.paragraphs ?? []) {
    for (const run of paragraph.runs) {
      if (run.id === runId) return run.text
    }
  }
  return undefined
}

/**
 * Re-expresses one history snapshot against the saved baseline. Returns null
 * when the snapshot cannot be represented at all (a saved delete that removed
 * the only paragraph its restoration could anchor to), so the caller drops it
 * rather than replaying it.
 */
export function translateSnapshot(
  snapshot: DraftState,
  baseline: SaveBaseline,
): DraftState | null {
  const next = structuredClone(snapshot)
  const identities = savedIdentities(baseline)
  const insertedRunIds = new Set(
    baseline.sent.inserts.flatMap((insert) =>
      (insert.runs ?? []).map((run) => run.id),
    ),
  )

  for (const slot of baseline.covered) {
    switch (slot.kind) {
      case 'run-text': {
        // A tracked replacement's run is absent from the reparsed model, so
        // its reversal is the rejection group the lineage carries, never a run
        // id for content the model does not have.
        const reversal = identities.runReversals.get(slot.runId)
        if (reversal) {
          delete next.drafts[slot.runId]
          addTrackedRejection(next, reversal)
          break
        }
        // A run on a paragraph the same save inserted is removed with that
        // paragraph's deletion; it is not separately addressable.
        if (insertedRunIds.has(slot.runId)) {
          delete next.drafts[slot.runId]
          break
        }
        // Never fall back to the base run id: it names unrelated content once
        // a save shifts run positions. The lineage address is the only reason
        // a reversal can be addressed before the model reloads.
        const address = identities.runAddresses.get(slot.runId)
        const targetRunId =
          identities.runIds.get(slot.runId) ??
          (address
            ? pendingRunAddressId(address)
            : pendingUnresolvedRunId(slot.runId))
        const pre =
          snapshot.drafts[slot.runId] ?? runText(baseline.fromModel, slot.runId)
        const post =
          baseline.sent.drafts[slot.runId] ??
          runText(baseline.fromModel, slot.runId)
        if (pre === undefined || pre === post) {
          delete next.drafts[slot.runId]
          break
        }
        delete next.drafts[slot.runId]
        next.drafts[targetRunId] = pre
        break
      }
      case 'paragraph-style': {
        const reversal = identities.paragraphReversals.get(slot.paragraphId)
        if (reversal) {
          delete next.format.paragraphStyles[slot.paragraphId]
          addTrackedRejection(next, reversal)
          break
        }
        const targetParagraphId =
          identities.paragraphIds.get(slot.paragraphId) ?? slot.paragraphId
        const pre =
          snapshot.format.paragraphStyles[slot.paragraphId] ??
          storyParagraph(baseline.fromModel, slot.paragraphId)?.styleId
        const post =
          baseline.sent.format.paragraphStyles[slot.paragraphId] ??
          storyParagraph(baseline.fromModel, slot.paragraphId)?.styleId
        if (pre === undefined || pre === post) {
          delete next.format.paragraphStyles[slot.paragraphId]
          break
        }
        if (
          baseline.toModel &&
          storyParagraph(baseline.toModel, targetParagraphId) === undefined
        ) {
          delete next.format.paragraphStyles[slot.paragraphId]
          break
        }
        delete next.format.paragraphStyles[slot.paragraphId]
        next.format.paragraphStyles[targetParagraphId] = pre
        break
      }
      case 'insert': {
        // A tracked paragraph insertion is one atomic edit: its content lives
        // inside `w:ins`, so no intermediate snapshot of it (an empty shell,
        // or a later edit within it) is separately representable. Every
        // snapshot of the insertion collapses to the same reversal: reject the
        // change and remove the shell, in one decision.
        const reversal = identities.insertReversals.get(slot.clientId)
        if (reversal) {
          next.inserts =
            removeInsert(next.inserts, slot.clientId)?.inserts ?? next.inserts
          addTrackedRejection(next, reversal.ooxmlIds, [
            reversal.removeParagraphId,
          ])
          break
        }
        const insert = snapshot.inserts.find(
          (item) => item.clientId === slot.clientId,
        )
        if (insert) {
          // The snapshot held the insert, so it describes the paragraph the
          // save stored. Its text becomes an override on that stored paragraph
          // instead of a fresh insertion.
          const preText = insertPlainText(insert)
          const saved = baseline.sent.inserts.find(
            (item) => item.clientId === slot.clientId,
          )
          const savedText = saved ? insertPlainText(saved) : ''
          next.inserts =
            removeInsert(next.inserts, slot.clientId)?.inserts ?? next.inserts
          if (preText !== savedText) {
            next.drafts[
              identities.insertedRuns.get(slot.clientId) ??
                pendingRunId(slot.clientId)
            ] = preText
          }
        } else {
          // The snapshot predates the insert, so it describes the document
          // without the paragraph the save stored. That is a deletion of the
          // stored paragraph; a tracked insertion took the reversal branch
          // above and never reaches here.
          next.deletedParagraphIds.push(
            identities.inserted.get(slot.clientId) ??
              pendingDeleteId(slot.clientId),
          )
        }
        break
      }
      case 'delete': {
        const reversal = identities.paragraphReversals.get(slot.paragraphId)
        if (
          reversal &&
          !snapshot.deletedParagraphIds.includes(slot.paragraphId)
        ) {
          // A tracked deletion leaves the paragraph in the model with its runs
          // hidden. Its reversal is the rejection group, not a restored copy.
          addTrackedRejection(next, reversal)
          break
        }
        if (snapshot.deletedParagraphIds.includes(slot.paragraphId)) {
          // The save stored the deletion, so the mask is the baseline.
          next.deletedParagraphIds = next.deletedParagraphIds.filter(
            (id) => id !== slot.paragraphId,
          )
          break
        }
        // The snapshot predates the deletion: reverse it by re-inserting the
        // paragraph the save removed, after its nearest surviving neighbour or,
        // for a deleted first paragraph, before the first survivor.
        const anchor = identities.restoredAnchors.get(slot.paragraphId)
        const beforeAnchor = identities.restoredBeforeAnchors.get(
          slot.paragraphId,
        )
        const restored = restoreInsert(
          baseline,
          slot.paragraphId,
          anchor,
          beforeAnchor,
        )
        if (!restored) return null
        next.inserts.push(restored)
        // The paragraph style rides on the insert so a restored paragraph keeps
        // it, exactly as collectEditOperations folds a pending insert's style.
        const style = storyParagraph(
          baseline.fromModel,
          slot.paragraphId,
        )?.styleId
        if (style) next.format.paragraphStyles[restored.clientId] = style
        break
      }
      case 'emphasis': {
        // Reverse the saved formatting by restating the pre-save properties at
        // the result address, instead of merely dropping the slot (which left
        // the saved formatting in place).
        const sent = baseline.sent.format.emphasis.find(
          (item) => emphasisSlotKey(item) === slot.key,
        )
        Object.assign(next, removeDraftSlots(next, [slot]))
        if (!sent) break
        const sentReversal =
          (sent.runId ? identities.runReversals.get(sent.runId) : undefined) ??
          (sent.paragraphId
            ? identities.paragraphReversals.get(sent.paragraphId)
            : undefined)
        if (sentReversal) {
          addTrackedRejection(next, sentReversal)
          break
        }
        const inverse = sent.runId
          ? preEmphasisForRun(baseline.fromModel, sent.runId)
          : sent.paragraphId !== undefined &&
              sent.from !== undefined &&
              sent.to !== undefined
            ? preEmphasisForRange(
                baseline.fromModel,
                sent.paragraphId,
                sent.from,
                sent.to,
              )
            : null
        if (!inverse) break
        const sentRunAddress = sent.runId
          ? identities.runAddresses.get(sent.runId)
          : undefined
        const address: PendingEmphasis = sent.runId
          ? {
              runId:
                identities.runIds.get(sent.runId) ??
                (sentRunAddress
                  ? pendingRunAddressId(sentRunAddress)
                  : pendingUnresolvedRunId(sent.runId)),
            }
          : {
              paragraphId:
                identities.paragraphIds.get(sent.paragraphId ?? '') ??
                sent.paragraphId,
              from: sent.from,
              to: sent.to,
            }
        next.format.emphasis = mergeEmphasis(next.format.emphasis, {
          ...address,
          ...inverse,
        })
        break
      }
      case 'numbering': {
        // Reverse a saved numbering change by restating the pre-save numbering
        // at the result paragraph, rather than merely dropping the slot. A
        // `w:pPr` holding tracked history never reaches the model's preserved
        // fragments (see paragraphFormatOf), so a pre-save numbering inside one
        // is not visible here: the same wire-model blind spot, recorded in the
        // Known divergences table.
        Object.assign(next, removeDraftSlots(next, [slot]))
        const reversal = identities.paragraphReversals.get(slot.paragraphId)
        if (reversal) {
          addTrackedRejection(next, reversal)
          break
        }
        const paragraph = storyParagraph(baseline.fromModel, slot.paragraphId)
        if (!paragraph) break
        const targetParagraphId =
          identities.paragraphIds.get(slot.paragraphId) ?? slot.paragraphId
        next.format.numbering[targetParagraphId] = paragraphNumPr(
          paragraph,
          baseline.fromModel.styles,
        ) ?? { numId: null }
        break
      }
      case 'paragraph-format': {
        // Reverse a saved paragraph-layout change by restating the pre-save
        // answer at the result paragraph. A family the save wrote that the
        // paragraph did not carry before is released with an explicit null, so
        // undo clears it rather than leaving the saved value.
        Object.assign(next, removeDraftSlots(next, [slot]))
        const reversal = identities.paragraphReversals.get(slot.paragraphId)
        if (reversal) {
          addTrackedRejection(next, reversal)
          break
        }
        const paragraph = storyParagraph(baseline.fromModel, slot.paragraphId)
        const sent = baseline.sent.format.paragraphFormats[slot.paragraphId]
        if (!paragraph || !sent) break
        const before = paragraphFormatOf(paragraph)
        const inverse: ParagraphFormatDraft = {
          ...(sent.alignment !== undefined
            ? { alignment: before.alignment ?? null }
            : {}),
          ...(sent.lineSpacing !== undefined
            ? { lineSpacing: before.lineSpacing ?? null }
            : {}),
          ...(sent.indentation !== undefined
            ? {
                // A complete snapshot, with explicit nulls for the attributes
                // the paragraph did not carry: the writer merges `w:ind`, so a
                // partial object would let an attribute the save added survive
                // its own reversal.
                indentation: {
                  left: before.indentation?.left ?? null,
                  right: before.indentation?.right ?? null,
                  firstLine: before.indentation?.firstLine ?? null,
                  hanging: before.indentation?.hanging ?? null,
                },
              }
            : {}),
        }
        if (Object.keys(inverse).length === 0) break
        const targetParagraphId =
          identities.paragraphIds.get(slot.paragraphId) ?? slot.paragraphId
        next.format.paragraphFormats[targetParagraphId] = inverse
        break
      }
      case 'extra-runs': {
        // A join folded the appended runs into the paragraph's last original
        // run. Restoring that run's pre-save text removes the appended content,
        // which is what undoing the join means.
        const paragraph = storyParagraph(baseline.fromModel, slot.paragraphId)
        const lastOriginal = paragraph?.runs.at(-1)
        Object.assign(next, removeDraftSlots(next, [slot]))
        if (!lastOriginal) break
        const reversal = identities.runReversals.get(lastOriginal.id)
        if (reversal) {
          addTrackedRejection(next, reversal)
          break
        }
        const lastAddress = identities.runAddresses.get(lastOriginal.id)
        const targetRunId =
          identities.runIds.get(lastOriginal.id) ??
          (lastAddress
            ? pendingRunAddressId(lastAddress)
            : pendingUnresolvedRunId(lastOriginal.id))
        const pre =
          snapshot.drafts[lastOriginal.id] ??
          runText(baseline.fromModel, lastOriginal.id)
        if (pre !== undefined) next.drafts[targetRunId] = pre
        break
      }
      default: {
        // Any other slot (there is none the editor produces today): a snapshot
        // that still holds it loses it to the new baseline and never replays
        // it, and the reversal is not silently claimed as persisted.
        Object.assign(next, removeDraftSlots(next, [slot]))
      }
    }
  }
  return next
}

/** Adds a tracked-change rejection group once, keyed by its change ids. */
function addTrackedRejection(
  state: DraftState,
  ooxmlIds: string[],
  removeParagraphIds?: string[],
) {
  const key = `reject:${ooxmlIds.join(',')}`
  if (!state.trackedRejections.some((group) => group.key === key)) {
    state.trackedRejections.push({
      key,
      ooxmlIds: [...ooxmlIds],
      ...(removeParagraphIds?.length
        ? { removeParagraphIds: [...removeParagraphIds] }
        : {}),
    })
    return
  }
  // A later translation of the same change may add the shell removal.
  if (!removeParagraphIds?.length) return
  const existing = state.trackedRejections.find((group) => group.key === key)
  if (existing && !existing.removeParagraphIds?.length) {
    existing.removeParagraphIds = [...removeParagraphIds]
  }
}

/** The pre-save character formatting of a run, for a formatting reversal. */
function preEmphasisForRun(
  model: DocumentModelWire,
  runId: string,
): PendingEmphasis | null {
  for (const paragraph of documentStory(model)?.paragraphs ?? []) {
    const run = paragraph.runs.find((item) => item.id === runId)
    if (run) return emphasisOf(run.preservedXmlFragments)
  }
  return null
}

/** The pre-save formatting at the start of a range, for a range reversal. */
function preEmphasisForRange(
  model: DocumentModelWire,
  paragraphId: string,
  from: number,
  to: number,
): PendingEmphasis | null {
  const paragraph = storyParagraph(model, paragraphId)
  if (!paragraph) return null
  let cursor = 0
  for (const run of paragraph.runs) {
    const end = cursor + run.text.length
    if (from >= cursor && from < end && to > cursor) {
      return emphasisOf(run.preservedXmlFragments)
    }
    cursor = end
  }
  return null
}

function emphasisOf(fragments: readonly string[]): PendingEmphasis {
  const properties = runPropertiesFromFragments(fragments)
  return {
    bold: properties.bold,
    italic: properties.italic,
    underline: properties.underline,
    strikethrough: properties.strikethrough,
    fontFamily: properties.fontFamily,
    fontSize: properties.fontSize,
    colour: properties.colour,
    highlight: properties.highlight,
    vertAlign: properties.vertAlign,
    smallCaps: properties.smallCaps,
  }
}

/**
 * Rebuilds a paragraph the save deleted, from the model that still held it.
 * The restored paragraph is an ordinary pending insert, so the next save sends
 * one insertion and the persisted document has exactly one copy.
 */
function restoreInsert(
  baseline: SaveBaseline,
  paragraphId: string,
  anchor: string | undefined,
  beforeAnchor: string | undefined,
): LocalInsert | null {
  const paragraph = storyParagraph(baseline.fromModel, paragraphId)
  if (!paragraph || (!anchor && !beforeAnchor)) return null
  return {
    clientId: pendingDeletedParagraphId(paragraphId),
    // SAFETY: the guard above returns unless `anchor` or `beforeAnchor` is set,
    // so a missing anchor here means `beforeAnchor` is a string.
    afterParagraphId: anchor ?? (beforeAnchor as string),
    ...(beforeAnchor ? { beforeParagraphId: beforeAnchor } : {}),
    text: paragraph.runs.map((run) => run.text).join(''),
    runs: paragraph.runs.map((run) => ({ ...run })),
  }
}

/**
 * Resolves the placeholders a pre-reload translation left behind now that the
 * saved model names the result content. An identity the model still cannot
 * name is kept, never dropped, so the caller can tell that the reversal cannot
 * be represented and block instead of silently losing it.
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

/** Whether a boundary still holds an identity the saved model has not named. */
export function hasPendingIdentities(baseline: SaveBaseline) {
  return baseline.toModel === undefined
}
