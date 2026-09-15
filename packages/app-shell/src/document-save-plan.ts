import type { DocumentModelWire } from '@obiter/contracts'
import {
  collectEditOperations,
  resolveInsertAnchor,
  type LocalInsert,
} from './document-edits'
import type { FormatDrafts } from './document-format-edits'
import { documentStory } from './document-model-text'
import type { ExtraRuns } from './document-word-edits'

/** The draft state that a save request is derived from. */
export type DraftState = {
  drafts: Record<string, string>
  inserts: LocalInsert[]
  deletedParagraphIds: string[]
  extraRuns: ExtraRuns
  format: FormatDrafts
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
    format: { emphasis: [], paragraphStyles: {}, numbering: {} },
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
  | { kind: 'emphasis'; key: string }

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

  const covered: DraftSlot[] = []
  const blocked: BlockedDraft[] = []
  const keep = emptyDraftState()

  for (const [runId, text] of Object.entries(state.drafts)) {
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

  state.format.emphasis.forEach((item) => {
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

  return {
    operations: collectEditOperations(
      model,
      keep.drafts,
      keep.inserts,
      keep.deletedParagraphIds,
      keep.extraRuns,
      keep.format,
    ),
    covered,
    blocked,
  }
}

/** Removes the named slots from a draft state, leaving everything else. */
export function removeDraftSlots(
  state: DraftState,
  slots: readonly DraftSlot[],
): DraftState {
  return splitDraftSlots(state, slots).remaining
}

/**
 * Splits the named slots out of a draft state. The removed fragment is what a
 * held change is: work the server would not accept, kept aside so it is neither
 * resent nor lost.
 */
export function splitDraftSlots(
  state: DraftState,
  slots: readonly DraftSlot[],
): { remaining: DraftState; removed: DraftState } {
  const drop = new Set(slots.map((slot) => slot.key))
  const drafts = splitKeys(state.drafts, drop, (key) => `run:${key}`)
  const extraRuns = splitKeys(state.extraRuns, drop, (key) => `extra:${key}`)
  const paragraphStyles = splitKeys(
    state.format.paragraphStyles,
    drop,
    (key) => `style:${key}`,
  )
  const numbering = splitKeys(
    state.format.numbering,
    drop,
    (key) => `number:${key}`,
  )
  const emphasis = {
    kept: state.format.emphasis.filter(
      (item) => !drop.has(emphasisSlotKey(item)),
    ),
    taken: state.format.emphasis.filter((item) =>
      drop.has(emphasisSlotKey(item)),
    ),
  }
  const insertIds = new Set(
    slots.flatMap((slot) => (slot.kind === 'insert' ? [slot.clientId] : [])),
  )
  return {
    remaining: {
      drafts: drafts.kept,
      inserts: state.inserts.filter(
        (insert) => !insertIds.has(insert.clientId),
      ),
      deletedParagraphIds: state.deletedParagraphIds.filter(
        (id) => !drop.has(`delete:${id}`),
      ),
      extraRuns: extraRuns.kept,
      format: {
        paragraphStyles: paragraphStyles.kept,
        numbering: numbering.kept,
        emphasis: emphasis.kept,
      },
    },
    removed: {
      drafts: drafts.taken,
      inserts: state.inserts.filter((insert) => insertIds.has(insert.clientId)),
      deletedParagraphIds: state.deletedParagraphIds.filter((id) =>
        drop.has(`delete:${id}`),
      ),
      extraRuns: extraRuns.taken,
      format: {
        paragraphStyles: paragraphStyles.taken,
        numbering: numbering.taken,
        emphasis: emphasis.taken,
      },
    },
  }
}

function splitKeys<T>(
  record: Record<string, T>,
  drop: ReadonlySet<string>,
  key: (name: string) => string,
): { kept: Record<string, T>; taken: Record<string, T> } {
  const kept: Record<string, T> = {}
  const taken: Record<string, T> = {}
  for (const [name, value] of Object.entries(record)) {
    if (drop.has(key(name))) taken[name] = value
    else kept[name] = value
  }
  return { kept, taken }
}

export function hasDraftState(state: DraftState) {
  return (
    Object.keys(state.drafts).length > 0 ||
    state.inserts.length > 0 ||
    state.deletedParagraphIds.length > 0 ||
    Object.keys(state.extraRuns).filter(
      (id) => (state.extraRuns[id] ?? []).length > 0,
    ).length > 0 ||
    state.format.emphasis.length > 0 ||
    Object.keys(state.format.paragraphStyles).length > 0 ||
    Object.keys(state.format.numbering).length > 0
  )
}

/**
 * The covered slots whose value is unchanged since the request was planned.
 * A slot edited while the request was in flight was not in it, so clearing that
 * slot would drop text the server never received.
 */
export function clearableSlots(
  covered: readonly DraftSlot[],
  sent: DraftState,
  current: DraftState,
): DraftSlot[] {
  return covered.filter(
    (slot) => slotFingerprint(current, slot) === slotFingerprint(sent, slot),
  )
}

/** A stable string for the draft content one slot holds. */
function slotFingerprint(state: DraftState, slot: DraftSlot): string {
  switch (slot.kind) {
    case 'run-text':
      return JSON.stringify(state.drafts[slot.runId])
    case 'extra-runs':
      return JSON.stringify(state.extraRuns[slot.paragraphId])
    case 'insert':
      return JSON.stringify(
        state.inserts.find((item) => item.clientId === slot.clientId),
      )
    case 'delete':
      return JSON.stringify(
        state.deletedParagraphIds.includes(slot.paragraphId),
      )
    case 'paragraph-style':
      return JSON.stringify(state.format.paragraphStyles[slot.paragraphId])
    case 'numbering':
      return JSON.stringify(state.format.numbering[slot.paragraphId])
    case 'emphasis': {
      const match = [...state.format.emphasis]
        .reverse()
        .find((item) => emphasisSlotKey(item) === slot.key)
      return JSON.stringify(match)
    }
  }
}

/** A short noun phrase naming what a slot holds, for user-facing disclosure. */
export function slotLabel(slot: DraftSlot): string {
  switch (slot.kind) {
    case 'run-text':
      return 'typed text'
    case 'extra-runs':
      return 'added text'
    case 'insert':
      return 'a new paragraph'
    case 'delete':
      return 'a paragraph deletion'
    case 'paragraph-style':
      return 'a paragraph style'
    case 'numbering':
      return 'list formatting'
    case 'emphasis':
      return 'formatting'
  }
}

function emphasisSlotKey(item: {
  runId?: string
  paragraphId?: string
  from?: number
  to?: number
}) {
  if (item.runId) return `emph:run:${item.runId}`
  return `emph:range:${item.paragraphId ?? ''}:${String(item.from ?? '')}:${String(item.to ?? '')}`
}
