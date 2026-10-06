import type { DraftSlot, DraftState } from './document-save-plan'
import { hasSectionDraft } from './document-section-format'

/** Removes the named slots from a draft state, leaving everything else. */
export function removeDraftSlots(
  state: DraftState,
  slots: readonly DraftSlot[],
): DraftState {
  return splitDraftSlots(state, slots).remaining
}

export type SplitDraftSlotsResult = {
  remaining: DraftState
  removed: DraftState
}

/**
 * Splits the named slots out of a draft state. The removed fragment is what a
 * held change is: work the server would not accept, kept aside so it is neither
 * resent nor lost.
 */
export function splitDraftSlots(
  state: DraftState,
  slots: readonly DraftSlot[],
): SplitDraftSlotsResult {
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
  const paragraphFormats = splitKeys(
    state.format.paragraphFormats,
    drop,
    (key) => `pformat:${key}`,
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
  const breakIds = new Set(
    slots.flatMap((slot) => (slot.kind === 'break' ? [slot.id] : [])),
  )
  const structureIds = new Set(
    slots.flatMap((slot) => (slot.kind === 'structure' ? [slot.id] : [])),
  )
  const rejections = {
    kept: state.trackedRejections.filter((group) => !drop.has(group.key)),
    taken: state.trackedRejections.filter((group) => drop.has(group.key)),
  }
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
      breaks: state.breaks.filter((item) => !breakIds.has(item.id)),
      structures: state.structures.filter((item) => !structureIds.has(item.id)),
      trackedRejections: rejections.kept,
      format: {
        paragraphStyles: paragraphStyles.kept,
        numbering: numbering.kept,
        paragraphFormats: paragraphFormats.kept,
        emphasis: emphasis.kept,
        section: drop.has('section') ? {} : state.format.section,
      },
    },
    removed: {
      drafts: drafts.taken,
      inserts: state.inserts.filter((insert) => insertIds.has(insert.clientId)),
      deletedParagraphIds: state.deletedParagraphIds.filter((id) =>
        drop.has(`delete:${id}`),
      ),
      extraRuns: extraRuns.taken,
      breaks: state.breaks.filter((item) => breakIds.has(item.id)),
      structures: state.structures.filter((item) => structureIds.has(item.id)),
      trackedRejections: rejections.taken,
      format: {
        paragraphStyles: paragraphStyles.taken,
        numbering: numbering.taken,
        paragraphFormats: paragraphFormats.taken,
        emphasis: emphasis.taken,
        section: drop.has('section') ? state.format.section : {},
      },
    },
  }
}

export interface SplitKeysResult<T> {
  kept: Record<string, T>
  taken: Record<string, T>
}

function splitKeys<T>(
  record: Record<string, T>,
  drop: ReadonlySet<string>,
  key: (name: string) => string,
): SplitKeysResult<T> {
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
    Object.keys(state.format.numbering).length > 0 ||
    Object.keys(state.format.paragraphFormats).length > 0 ||
    hasSectionDraft(state.format.section) ||
    state.breaks.length > 0 ||
    state.structures.length > 0 ||
    state.trackedRejections.length > 0
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
    case 'paragraph-format':
      return JSON.stringify(state.format.paragraphFormats[slot.paragraphId])
    case 'emphasis': {
      const match = [...state.format.emphasis]
        .reverse()
        .find((item) => emphasisSlotKey(item) === slot.key)
      return JSON.stringify(match)
    }
    case 'section':
      return JSON.stringify(state.format.section)
    case 'break':
      return JSON.stringify(state.breaks.find((item) => item.id === slot.id))
    case 'structure':
      return JSON.stringify(
        state.structures.find((item) => item.id === slot.id),
      )
    case 'tracked-reject':
      return JSON.stringify(
        state.trackedRejections.find((group) => group.key === slot.key),
      )
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
    case 'paragraph-format':
      return 'paragraph formatting'
    case 'emphasis':
      return 'formatting'
    case 'section':
      return 'page setup'
    case 'break':
      return slot.breakKind === 'page' ? 'a page break' : 'a section break'
    case 'structure':
      return slot.structureKind === 'table'
        ? 'a table'
        : slot.structureKind === 'image'
          ? 'a picture'
          : slot.structureKind === 'link'
            ? 'a hyperlink'
            : slot.structureKind === 'cross-reference'
              ? 'a cross-reference'
              : slot.structureKind === 'footnote'
                ? 'a footnote'
                : slot.structureKind === 'table-of-contents'
                  ? 'a table of contents'
                  : 'a page number'
    case 'tracked-reject':
      return 'a tracked change'
  }
}

export function emphasisSlotKey(item: {
  runId?: string
  paragraphId?: string
  from?: number
  to?: number
}) {
  if (item.runId) return `emph:run:${item.runId}`
  return `emph:range:${item.paragraphId ?? ''}:${String(item.from ?? '')}:${String(item.to ?? '')}`
}
