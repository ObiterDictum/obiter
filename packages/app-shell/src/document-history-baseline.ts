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
import { mergeEmphasis } from './document-format-edits'
import type { PendingEmphasis } from './document-format-types'
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

type SavedIdentities = {
  /** Covered insert clientId -> the stored paragraph it became. */
  inserted: Map<string, string>
  /** Covered insert clientId -> the stored paragraph's first run. */
  insertedRuns: Map<string, string>
  /** Covered deleted paragraphId -> the surviving paragraph it re-inserts after. */
  restoredAnchors: Map<string, string>
  /** Base paragraph id -> result paragraph id (authoritative lineage only). */
  paragraphIds: Map<string, string>
  /** Base run id -> the result run that continues it. */
  runIds: Map<string, string>
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
    paragraphIds: new Map(),
    runIds: new Map(),
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
): Record<string, T> {
  const next: Record<string, T> = {}
  for (const [key, value] of Object.entries(record)) {
    next[remap(key)] = value
  }
  return next
}

/**
 * Retargets the paragraph identifiers a live draft state still holds after a
 * save renamed them. Run identifiers are not canonicalised, so the text
 * overrides are left alone; the paragraph-keyed maps and inserted anchors are
 * rewritten to the result ids the reloaded model uses.
 */
export function remapDraftStateParagraphs(
  state: DraftState,
  lineage: DocumentVersionLineage,
): DraftState {
  const map = paragraphMapFromLineage(lineage)
  if (map.size === 0) return state
  const remap = (id: string) => map.get(id) ?? id
  return {
    ...state,
    inserts: state.inserts.map((insert) =>
      map.has(insert.afterParagraphId)
        ? { ...insert, afterParagraphId: remap(insert.afterParagraphId) }
        : insert,
    ),
    deletedParagraphIds: state.deletedParagraphIds.map(remap),
    extraRuns: remapRecordKeys(state.extraRuns, remap),
    format: {
      ...state.format,
      paragraphStyles: remapRecordKeys(state.format.paragraphStyles, remap),
      numbering: remapRecordKeys(state.format.numbering, remap),
      emphasis: state.format.emphasis.map((item) =>
        item.paragraphId
          ? { ...item, paragraphId: remap(item.paragraphId) }
          : item,
      ),
    },
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
 * Whether the lineage names every covered insertion and deletion. A response
 * that omits one is incomplete, so the caller must not translate it.
 */
export function lineageCoversCoveredSlots(
  lineage: DocumentVersionLineage,
  baseline: Pick<SaveBaseline, 'covered' | 'sent'>,
): boolean {
  for (const slot of baseline.covered) {
    if (slot.kind === 'insert') {
      const mapped = lineage.paragraphs.some(
        (entry) => entry.insertedByIntent === slot.clientId,
      )
      if (!mapped) return false
    }
    if (slot.kind === 'delete') {
      const mapped = lineage.paragraphs.some(
        (entry) => entry.fromParagraphId === slot.paragraphId,
      )
      if (!mapped) return false
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
  const paragraphIds = new Map<string, string>()
  const runIds = new Map<string, string>()

  for (const entry of lineage.paragraphs) {
    if (entry.fromParagraphId && entry.toParagraphId) {
      paragraphIds.set(entry.fromParagraphId, entry.toParagraphId)
    }
    if (!entry.toParagraphId || !toModel) continue
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
    if (!anchor) continue
    restoredAnchors.set(slot.paragraphId, paragraphIds.get(anchor) ?? anchor)
  }

  return { inserted, insertedRuns, restoredAnchors, paragraphIds, runIds }
}

function firstRunId(model: DocumentModelWire, paragraphId: string) {
  const paragraph = storyParagraph(model, paragraphId)
  return paragraph?.runs[0]?.id
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

  for (const slot of baseline.covered) {
    switch (slot.kind) {
      case 'run-text': {
        const targetRunId = identities.runIds.get(slot.runId) ?? slot.runId
        const pre =
          snapshot.drafts[slot.runId] ?? runText(baseline.fromModel, slot.runId)
        const post =
          baseline.sent.drafts[slot.runId] ??
          runText(baseline.fromModel, slot.runId)
        if (pre === undefined || pre === post) {
          delete next.drafts[slot.runId]
          break
        }
        if (
          baseline.toModel &&
          runText(baseline.toModel, targetRunId) === undefined
        ) {
          delete next.drafts[slot.runId]
          break
        }
        delete next.drafts[slot.runId]
        next.drafts[targetRunId] = pre
        break
      }
      case 'paragraph-style': {
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
          // stored paragraph.
          next.deletedParagraphIds.push(
            identities.inserted.get(slot.clientId) ??
              pendingDeleteId(slot.clientId),
          )
        }
        break
      }
      case 'delete': {
        if (snapshot.deletedParagraphIds.includes(slot.paragraphId)) {
          // The save stored the deletion, so the mask is the baseline.
          next.deletedParagraphIds = next.deletedParagraphIds.filter(
            (id) => id !== slot.paragraphId,
          )
          break
        }
        // The snapshot predates the deletion: reverse it by re-inserting the
        // paragraph the save removed, after its nearest surviving neighbour.
        const anchor = identities.restoredAnchors.get(slot.paragraphId)
        const restored = restoreInsert(baseline, slot.paragraphId, anchor)
        if (!restored) return null
        next.inserts.push(restored)
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
        const address: PendingEmphasis = sent.runId
          ? { runId: identities.runIds.get(sent.runId) ?? sent.runId }
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
      default: {
        // Numbering and appended runs: a snapshot that still holds the slot
        // loses it to the new baseline and never replays it.
        Object.assign(next, removeDraftSlots(next, [slot]))
      }
    }
  }
  return next
}

/** The pre-save bold/italic/underline of a run, for a formatting reversal. */
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
): LocalInsert | null {
  const paragraph = storyParagraph(baseline.fromModel, paragraphId)
  if (!paragraph || !anchor) return null
  return {
    clientId: pendingDeletedParagraphId(paragraphId),
    afterParagraphId: anchor,
    text: paragraph.runs.map((run) => run.text).join(''),
    runs: paragraph.runs.map((run) => ({ ...run })),
  }
}

/**
 * Resolves the placeholders a pre-reload translation left behind now that the
 * saved model names the paragraphs. An identity that still cannot be matched is
 * dropped: it was never replayable, and a stale id would only be blocked later.
 */
export function resolveBaselineIdentities(
  state: DraftState,
  baseline: SaveBaseline,
): DraftState {
  const identities = savedIdentities(baseline)
  const drafts: Record<string, string> = {}
  for (const [key, value] of Object.entries(state.drafts)) {
    if (!isPendingBaselineId(key)) {
      drafts[key] = value
      continue
    }
    const clientId = key.slice(`${PENDING_BASELINE_PREFIX}run:`.length)
    const runId = identities.insertedRuns.get(clientId)
    if (runId) drafts[runId] = value
  }
  const deletedParagraphIds: string[] = []
  for (const id of state.deletedParagraphIds) {
    if (!isPendingBaselineId(id)) {
      deletedParagraphIds.push(id)
      continue
    }
    const clientId = id.slice(`${PENDING_BASELINE_PREFIX}delete:`.length)
    const paragraphId = identities.inserted.get(clientId)
    if (paragraphId) deletedParagraphIds.push(paragraphId)
  }
  return { ...state, drafts, deletedParagraphIds }
}

/** Whether a boundary still holds an identity the saved model has not named. */
export function hasPendingIdentities(baseline: SaveBaseline) {
  return baseline.toModel === undefined
}
