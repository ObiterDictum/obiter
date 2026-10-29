import type {
  DocumentModelWire,
  DocumentVersionLineage,
} from '@obiter/contracts'
import {
  PENDING_BASELINE_PREFIX,
  type DraftSlot,
  type DraftState,
} from './document-save-plan'
import { lineageIdentities } from './document-baseline-lineage'

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
   * The version the request was planned against. Structural sharing can keep
   * `fromModel` referentially identical to a reloaded model whose projection
   * did not change, so "still the pre-flight model" is a version test, not a
   * reference test.
   */
  fromVersionId?: string
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

export function pendingDeleteId(clientId: string) {
  return `${PENDING_BASELINE_PREFIX}delete:${clientId}`
}

export function pendingRunId(clientId: string) {
  return `${PENDING_BASELINE_PREFIX}run:${clientId}`
}

export function pendingDeletedParagraphId(paragraphId: string) {
  return `${PENDING_BASELINE_PREFIX}restore:${paragraphId}`
}

/**
 * The result address of a base run: the persisted paragraph it continues and
 * its index in that paragraph's run list. This is the lineage's own result
 * address; the model run id (`text-NNNNNN`) is positional and only knowable
 * once the reloaded model is in hand.
 */
export type RunAddress = { paragraphId: string; runIndex: number }

export function pendingRunAddressId(address: RunAddress) {
  return `${PENDING_BASELINE_PREFIX}run-address:${address.paragraphId}:${String(address.runIndex)}`
}

/** A covered run the lineage never names. It is never sent; it stays pending. */
export function pendingUnresolvedRunId(baseRunId: string) {
  return `${PENDING_BASELINE_PREFIX}run-unresolved:${baseRunId}`
}

/**
 * One result run that continues a base run: where the lineage puts it and
 * which slice of the base run's saved text it carries. A mid-run structure
 * splice splits one base run into several continuing result runs, and the
 * slices index the text the run carried into the result — its replacement
 * text when the batch replaced it. Ordered by result position.
 */
export type RunContinuation = {
  address: RunAddress
  /** The result run's model id, once the reloaded model names it. */
  runId: string | undefined
  /** Start of this run's slice of the base run's saved text. */
  from: number
  /** End of that slice. */
  to: number
}

export function parsePendingRunAddress(key: string): RunAddress | null {
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

export type SavedIdentities = {
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
   * Base run id -> every result run continuing it, in result order. A run the
   * save spliced around an inline structure continues as several; keeping the
   * whole list is what lets a reversal distribute the pre-save text across
   * the parts instead of writing it to the first and duplicating the tail's
   * saved text beside it.
   */
  runContinuations: Map<string, RunContinuation[]>
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
export function savedIdentities(baseline: SaveBaseline): SavedIdentities {
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
    runContinuations: new Map(),
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

/** The run ids the sent inserts carry — the parts a tracked insertion's
 * reversal must reject rather than restore. */
export function sentInsertRunIds(baseline: SaveBaseline) {
  return new Set(
    baseline.sent.inserts.flatMap((insert) =>
      (insert.runs ?? []).map((run) => run.id),
    ),
  )
}

export function remapRecordKeys<T>(
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
