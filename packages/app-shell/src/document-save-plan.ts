import type { DocumentModelWire } from '@obiter/contracts'
import {
  collectEditOperations,
  flowParagraphIds,
  LAST_PARAGRAPH_MESSAGE,
  resolveInsertAnchor,
  type BreakDraft,
  type LocalInsert,
} from './document-edits'
import type { FormatDrafts } from './document-format-edits'
import { emphasisSlotKey } from './document-save-slots'
import { sectionDraftFields } from './document-section-format'
import { documentStory } from './document-model-text'
import type { ExtraRuns } from './document-word-edits'

/**
 * The draft state that a save request is derived from.
 */
export type DraftState = {
  drafts: Record<string, string>
  inserts: LocalInsert[]
  deletedParagraphIds: string[]
  extraRuns: ExtraRuns
  format: FormatDrafts
  /** Page and section breaks held before save, caret-anchored per paragraph. */
  breaks: BreakDraft[]
  /**
   * Tracked changes a saved edit left behind, grouped by the history step that
   * created them. A tracked text replacement removes its run from the reparsed
   * model, so its reversal is a tracked-change rejection addressed by persisted
   * `w:id`, never a run id. Each group is rejected as one unit.
   */
  trackedRejections: TrackedRejection[]
}

/** One history step's tracked changes, rejected together. */
export type TrackedRejection = {
  /** Stable key for clearing/looking up this group. */
  key: string
  /** Persisted OOXML change ids (`w:id`) to reject as a unit. */
  ooxmlIds: string[]
  /**
   * Persisted paragraph ids (`para-w14-<value>`) whose empty tracked-insert
   * shell this rejection removes in the same decision. A tracked paragraph
   * insertion wraps its content in `w:ins`, so rejecting it alone would leave
   * an empty paragraph behind.
   */
  removeParagraphIds?: string[]
}

/**
 * A structural reversal a save boundary has not been able to address yet,
 * because the reloaded model has not named the paragraph it created or removed.
 * It is not user work: the planner never sends it and never reports it blocked,
 * and the boundary resolves it to a real identity when the model arrives. See
 * `document-history-baseline.ts`.
 */
export const PENDING_BASELINE_PREFIX = 'pending-baseline:'

export function isPendingBaselineId(id: string) {
  return id.startsWith(PENDING_BASELINE_PREFIX)
}

/**
 * A fresh draft state. `format` is built here rather than reused from
 * `emptyFormatDrafts`: planDocumentSave fills a copy in place, so sharing the
 * module singleton would leak one workspace's paragraph styles into every
 * other one.
 */
export function emptyDraftState(): DraftState {
  return {
    drafts: {},
    inserts: [],
    deletedParagraphIds: [],
    extraRuns: {},
    format: {
      emphasis: [],
      paragraphStyles: {},
      numbering: {},
      paragraphFormats: {},
      section: {},
    },
    breaks: [],
    trackedRejections: [],
  }
}

/**
 * A named region of draft state. Slots are the unit of clearing after a save
 * and of discarding a change the server will not accept.
 */
export type DraftSlot =
  | { kind: 'run-text'; key: string; runId: string }
  | { kind: 'extra-runs'; key: string; paragraphId: string }
  | { kind: 'insert'; key: string; clientId: string }
  | { kind: 'delete'; key: string; paragraphId: string }
  | { kind: 'paragraph-style'; key: string; paragraphId: string }
  | { kind: 'numbering'; key: string; paragraphId: string }
  | { kind: 'paragraph-format'; key: string; paragraphId: string }
  | { kind: 'emphasis'; key: string }
  | { kind: 'section'; key: string }
  | { kind: 'break'; key: string; id: string; breakKind: 'page' | 'section' }
  | { kind: 'tracked-reject'; key: string; ooxmlIds: string[] }

export type BlockedDraft = {
  slot: DraftSlot
  reason: string
  label: string
}

export type SavePlan = {
  /** Addressable operations, safe to send as one batch. */
  operations: ReturnType<typeof collectEditOperations>
  /**
   * Slots the request covers. A successful save clears exactly these; every
   * other slot (blocked ones) survives.
   */
  covered: DraftSlot[]
  /** Slots that cannot be addressed against this model, so they are not sent. */
  blocked: BlockedDraft[]
  /**
   * Pending-baseline reversals that no model names yet. They are not sent and
   * not blocked, but they are unsaved work, so the workspace must not report
   * itself saved while one exists.
   */
  pending: number
  /**
   * Tracked-change decisions to send, one per history step. Each carries the
   * current version's wire change ids resolved from the persisted `w:id`s, and
   * any empty tracked-insert shells to remove in the same decision.
   */
  rejections: Array<{
    key: string
    ooxmlIds: string[]
    changeIds: string[]
    removeParagraphIds?: string[]
  }>
}

/**
 * Partitions draft state into what the server can accept and what it cannot.
 *
 * E45: a format draft keyed to a client-side pending-insert id was emitted as
 * `set_paragraph_style` against an id that does not exist server-side, so every
 * later save resent it and failed. Addressability is therefore decided here,
 * against the loaded model, before any batch is built. A slot whose target is
 * absent from the model is held back rather than sent, so one stale change
 * cannot poison a later request, and the caller can still clear precisely the
 * slots the request covered.
 */
export function planDocumentSave(
  model: DocumentModelWire,
  state: DraftState,
): SavePlan {
  const story = documentStory(model)
  const paragraphIds = new Set(
    (story?.paragraphs ?? []).map((paragraph) => paragraph.id),
  )
  const runIds = new Set(
    (story?.paragraphs ?? []).flatMap((paragraph) =>
      paragraph.runs.map((run) => run.id),
    ),
  )
  const insertById = new Map(state.inserts.map((item) => [item.clientId, item]))
  const realIds = paragraphIds

  let covered: DraftSlot[] = []
  const blocked: BlockedDraft[] = []
  const keep = emptyDraftState()
  let pending = 0

  for (const [runId, text] of Object.entries(state.drafts)) {
    if (isPendingBaselineId(runId)) {
      pending += 1
      continue
    }
    if (!runIds.has(runId)) {
      if (text.trim().length === 0) continue
      blocked.push({
        slot: { kind: 'run-text', key: `run:${runId}`, runId },
        reason: 'The text this edit belonged to is no longer in the document.',
        label: 'typed text',
      })
      continue
    }
    keep.drafts[runId] = text
    covered.push({ kind: 'run-text', key: `run:${runId}`, runId })
  }

  for (const [paragraphId, runs] of Object.entries(state.extraRuns)) {
    // A persisted draft from before empty lists were dropped may still carry
    // one; it holds nothing, so it is not a slot.
    if (runs.length === 0) continue
    if (!paragraphIds.has(paragraphId)) {
      blocked.push({
        slot: {
          kind: 'extra-runs',
          key: `extra:${paragraphId}`,
          paragraphId,
        },
        reason: 'This paragraph is no longer in the document.',
        label: 'added text',
      })
      continue
    }
    keep.extraRuns[paragraphId] = runs
    covered.push({
      kind: 'extra-runs',
      key: `extra:${paragraphId}`,
      paragraphId,
    })
  }

  for (const insert of state.inserts) {
    const anchor = resolveInsertAnchor(insert, insertById, realIds)
    if (!paragraphIds.has(anchor)) {
      blocked.push({
        slot: {
          kind: 'insert',
          key: `insert:${insert.clientId}`,
          clientId: insert.clientId,
        },
        reason:
          'This new paragraph was placed after one that is no longer in the document.',
        label: 'a new paragraph',
      })
      continue
    }
    keep.inserts.push(insert)
    covered.push({
      kind: 'insert',
      key: `insert:${insert.clientId}`,
      clientId: insert.clientId,
    })
  }

  for (const paragraphId of state.deletedParagraphIds) {
    if (isPendingBaselineId(paragraphId)) {
      pending += 1
      continue
    }
    if (!paragraphIds.has(paragraphId)) {
      blocked.push({
        slot: { kind: 'delete', key: `delete:${paragraphId}`, paragraphId },
        reason: 'This paragraph was already removed from the document.',
        label: 'a deletion',
      })
      continue
    }
    keep.deletedParagraphIds.push(paragraphId)
    covered.push({ kind: 'delete', key: `delete:${paragraphId}`, paragraphId })
  }

  for (const item of state.breaks) {
    if (!paragraphIds.has(item.paragraphId)) {
      blocked.push({
        slot: {
          kind: 'break',
          key: `break:${item.id}`,
          id: item.id,
          breakKind: item.kind,
        },
        reason:
          'The paragraph this break was placed in is no longer in the document.',
        label: item.kind === 'page' ? 'a page break' : 'a section break',
      })
      continue
    }
    keep.breaks.push(item)
    covered.push({
      kind: 'break',
      key: `break:${item.id}`,
      id: item.id,
      breakKind: item.kind,
    })
  }

  for (const [paragraphId, styleId] of Object.entries(
    state.format.paragraphStyles,
  )) {
    if (paragraphIds.has(paragraphId)) {
      keep.format.paragraphStyles[paragraphId] = styleId
      covered.push({
        kind: 'paragraph-style',
        key: `style:${paragraphId}`,
        paragraphId,
      })
      continue
    }
    // A pending insert carries its own paragraph style: the insert operation
    // sets it, so no separate address is needed. collectEditOperations folds
    // this entry into the insert and omits it from collectFormatOperations.
    // It is still a covered slot so a successful save clears it with the insert.
    if (insertById.has(paragraphId)) {
      keep.format.paragraphStyles[paragraphId] = styleId
      covered.push({
        kind: 'paragraph-style',
        key: `style:${paragraphId}`,
        paragraphId,
      })
      continue
    }
    blocked.push({
      slot: {
        kind: 'paragraph-style',
        key: `style:${paragraphId}`,
        paragraphId,
      },
      reason: 'This paragraph is no longer in the document.',
      label: 'a paragraph style',
    })
  }

  for (const [paragraphId, numbering] of Object.entries(
    state.format.numbering,
  )) {
    if (paragraphIds.has(paragraphId)) {
      keep.format.numbering[paragraphId] = numbering
      covered.push({
        kind: 'numbering',
        key: `number:${paragraphId}`,
        paragraphId,
      })
      continue
    }
    // Numbering is a separate operation with no paragraph id of its own until
    // the insert has run, so it cannot be composed onto the insert.
    const onInsert = insertById.has(paragraphId)
    blocked.push({
      slot: { kind: 'numbering', key: `number:${paragraphId}`, paragraphId },
      reason: onInsert
        ? 'List formatting on a paragraph that has not been saved yet cannot be sent separately.'
        : 'This paragraph is no longer in the document.',
      label: onInsert
        ? 'list formatting on a new paragraph'
        : 'list formatting',
    })
  }

  for (const [paragraphId, paragraphFormat] of Object.entries(
    state.format.paragraphFormats,
  )) {
    if (paragraphIds.has(paragraphId)) {
      keep.format.paragraphFormats[paragraphId] = paragraphFormat
      covered.push({
        kind: 'paragraph-format',
        key: `pformat:${paragraphId}`,
        paragraphId,
      })
      continue
    }
    // Paragraph layout is a separate operation with no paragraph id of its own
    // until the insert has run, so it cannot be composed onto the insert.
    const onInsert = insertById.has(paragraphId)
    blocked.push({
      slot: {
        kind: 'paragraph-format',
        key: `pformat:${paragraphId}`,
        paragraphId,
      },
      reason: onInsert
        ? 'Paragraph formatting on a paragraph that has not been saved yet cannot be sent separately.'
        : 'This paragraph is no longer in the document.',
      label: onInsert
        ? 'paragraph formatting on a new paragraph'
        : 'paragraph formatting',
    })
  }

  const sectionFields = sectionDraftFields(state.format.section)
  if (sectionFields) {
    keep.format.section = state.format.section
    covered.push({ kind: 'section', key: 'section' })
  }

  state.format.emphasis.forEach((item) => {
    // A run-keyed reversal the save boundary has not named yet is pending: it
    // is neither sent nor blocked, and it keeps the document unsaved.
    if (item.runId !== undefined && isPendingBaselineId(item.runId)) {
      pending += 1
      return
    }
    const addressable =
      item.runId !== undefined
        ? runIds.has(item.runId)
        : item.paragraphId !== undefined &&
          paragraphIds.has(item.paragraphId) &&
          item.from !== undefined &&
          item.to !== undefined &&
          item.from < item.to
    const key = emphasisSlotKey(item)
    if (addressable) {
      keep.format.emphasis.push(item)
      covered.push({ kind: 'emphasis', key })
      return
    }
    blocked.push({
      slot: { kind: 'emphasis', key },
      reason:
        'The text this formatting applied to is no longer in the document.',
      label: 'formatting',
    })
  })

  // A tracked reversal is a decision, not an edit operation. Its persisted
  // `w:id`s are resolved against the loaded model's change list; a change the
  // model no longer names blocks honestly rather than targeting a stale id.
  const rejections: SavePlan['rejections'] = []
  for (const group of state.trackedRejections) {
    const changeIds: string[] = []
    let unresolved = false
    for (const ooxmlId of group.ooxmlIds) {
      const change = model.changes.find((item) => item.ooxmlId === ooxmlId)
      if (change) changeIds.push(change.id)
      else unresolved = true
    }
    if (unresolved || changeIds.length === 0) {
      blocked.push({
        slot: {
          kind: 'tracked-reject',
          key: group.key,
          ooxmlIds: group.ooxmlIds,
        },
        reason:
          'The tracked change this undo reverses is no longer in the document.',
        label: 'a tracked change',
      })
      continue
    }
    rejections.push({
      key: group.key,
      ooxmlIds: group.ooxmlIds,
      changeIds,
      ...(group.removeParagraphIds?.length
        ? { removeParagraphIds: [...group.removeParagraphIds] }
        : {}),
    })
  }

  // A restored or constructed draft state can hold deletions that would leave
  // no effective paragraph. Block them rather than send a batch the server must
  // reject; the client guard already stops the editor creating this state, so
  // this is the save-plan safety net. `flowParagraphIds` is the same canonical
  // derivation the ribbon and the delete operation use.
  if (
    flowParagraphIds(model, keep.inserts, keep.deletedParagraphIds).length < 1
  ) {
    for (const slot of covered) {
      if (slot.kind !== 'delete') continue
      blocked.push({
        slot,
        reason: LAST_PARAGRAPH_MESSAGE,
        label: 'a deletion',
      })
    }
    covered = covered.filter((slot) => slot.kind !== 'delete')
    keep.deletedParagraphIds = []
  }

  return {
    operations: collectEditOperations(
      model,
      keep.drafts,
      keep.inserts,
      keep.deletedParagraphIds,
      keep.extraRuns,
      keep.format,
      keep.breaks,
    ),
    covered,
    blocked,
    pending,
    rejections,
  }
}

export {
  clearableSlots,
  emphasisSlotKey,
  hasDraftState,
  removeDraftSlots,
  slotLabel,
  splitDraftSlots,
} from './document-save-slots'
export type {
  SplitDraftSlotsResult,
  SplitKeysResult,
} from './document-save-slots'
