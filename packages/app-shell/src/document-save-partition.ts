import { revisionOnlyParagraph } from './document-inline-index'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  emptyDraftState,
  isPendingBaselineId,
  type BlockedDraft,
  type DraftSlot,
  type DraftState,
} from './document-draft-state'
import { editableStories } from './document-model-text'
import {
  batchParagraphDeletions,
  FIELD_BOUNDARY_MESSAGE,
  LAST_PARAGRAPH_MESSAGE,
} from './document-edits'
import { footnoteNoteParagraphId } from './document-structural-drafts'
import { partitionFormatDrafts } from './document-format-partition'
import { emphasisSlotKey } from './document-save-slots'
import { resolveInsertAnchor } from './document-story-flow'
import { partitionStructureSlots } from './document-structure-partition'

export type ResolvedRejection = {
  key: string
  ooxmlIds: string[]
  changeIds: string[]
  removeParagraphIds?: string[]
}

export type SavePartition = {
  keep: DraftState
  covered: DraftSlot[]
  blocked: BlockedDraft[]
  pending: number
  rejections: ResolvedRejection[]
}

export function partitionDraftState(
  model: DocumentModelWire,
  state: DraftState,
): SavePartition {
  const editable = editableStories(model)
  const paragraphs = new Map(
    editable.flatMap((story) =>
      story.paragraphs.map((p) => [p.id, p] as const),
    ),
  )
  const paragraphIds = new Set(
    editable.flatMap((story) => story.paragraphs.map((item) => item.id)),
  )
  const runIds = new Set(
    editable.flatMap((story) =>
      story.paragraphs.flatMap((paragraph) =>
        paragraph.runs.map((run) => run.id),
      ),
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

  const noteParagraphById = new Map(
    state.structures
      .filter((item) => item.kind === 'footnote')
      .map((item) => [footnoteNoteParagraphId(item), item.id]),
  )
  const deferredNoteRuns: { paragraphId: string; structureId: string }[] = []

  for (const [paragraphId, runs] of Object.entries(state.extraRuns)) {
    if (runs.length === 0) continue
    const structureId = noteParagraphById.get(paragraphId)
    if (structureId !== undefined) {
      deferredNoteRuns.push({ paragraphId, structureId })
      continue
    }
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
    const paragraph = paragraphs.get(paragraphId)
    if (paragraph && revisionOnlyParagraph(model, paragraph)) {
      blocked.push({
        slot: { kind: 'extra-runs', key: `extra:${paragraphId}`, paragraphId },
        reason:
          'Decide the tracked changes before adding text to this paragraph.',
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

  const deletions = batchParagraphDeletions(
    model,
    keep.inserts,
    keep.deletedParagraphIds,
    keep.extraRuns,
    keep.drafts,
  )
  if (deletions.emptied.size > 0) {
    for (const slot of covered) {
      if (slot.kind !== 'delete' || !deletions.emptied.has(slot.paragraphId)) {
        continue
      }
      blocked.push({
        slot,
        reason:
          deletions.emptied.get(slot.paragraphId) ?? LAST_PARAGRAPH_MESSAGE,
        label: 'a deletion',
      })
    }
    covered = covered.filter(
      (slot) =>
        slot.kind !== 'delete' || !deletions.emptied.has(slot.paragraphId),
    )
    keep.deletedParagraphIds = keep.deletedParagraphIds.filter(
      (id) => !deletions.emptied.has(id),
    )
  }
  if (deletions.split.size > 0) {
    const removesFieldBoundary = (
      slot: DraftSlot,
    ): slot is Extract<DraftSlot, { kind: 'delete' | 'extra-runs' }> => {
      if (slot.kind !== 'delete' && slot.kind !== 'extra-runs') return false
      if (!deletions.split.has(slot.paragraphId)) return false
      return slot.kind === 'delete' || deletions.implicit.has(slot.paragraphId)
    }
    for (const slot of covered) {
      if (!removesFieldBoundary(slot)) continue
      blocked.push({
        slot,
        reason: deletions.split.get(slot.paragraphId) ?? FIELD_BOUNDARY_MESSAGE,
        label: slot.kind === 'delete' ? 'a deletion' : 'added text',
      })
    }
    covered = covered.filter((slot) => !removesFieldBoundary(slot))
    keep.deletedParagraphIds = keep.deletedParagraphIds.filter(
      (id) => !deletions.split.has(id),
    )
    for (const paragraphId of deletions.split.keys()) {
      if (deletions.implicit.has(paragraphId)) {
        delete keep.extraRuns[paragraphId]
      }
    }
  }
  const batchDeletions = deletions.effective
  const paragraphWires = new Map(
    editable
      .flatMap((story) => story.paragraphs)
      .map((paragraph) => [paragraph.id, paragraph]),
  )
  const paragraphStoryKind = new Map(
    editable.flatMap((story) =>
      story.paragraphs.map((paragraph) => [paragraph.id, story.kind] as const),
    ),
  )
  const blockedStructureReasons = new Map<string, string>()
  partitionStructureSlots({
    model,
    state,
    paragraphIds,
    batchDeletions,
    paragraphStoryKind,
    paragraphWires,
    keep,
    covered,
    blocked,
    blockedStructureReasons,
  })

  for (const deferred of deferredNoteRuns) {
    if (keep.structures.some((item) => item.id === deferred.structureId)) {
      keep.extraRuns[deferred.paragraphId] =
        state.extraRuns[deferred.paragraphId] ?? []
      covered.push({
        kind: 'extra-runs',
        key: `extra:${deferred.paragraphId}`,
        paragraphId: deferred.paragraphId,
      })
      continue
    }
    blocked.push({
      slot: {
        kind: 'extra-runs',
        key: `extra:${deferred.paragraphId}`,
        paragraphId: deferred.paragraphId,
      },
      reason:
        blockedStructureReasons.get(deferred.structureId) ??
        'The paragraph this footnote was placed in is no longer in the document.',
      label: 'note text',
    })
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

  const format = partitionFormatDrafts(state, paragraphIds, insertById, keep)
  covered.push(...format.covered)
  blocked.push(...format.blocked)

  state.format.emphasis.forEach((item) => {
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

  const rejections: ResolvedRejection[] = []
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

  return { keep, covered, blocked, pending, rejections }
}
