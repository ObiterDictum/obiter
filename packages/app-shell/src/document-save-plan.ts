import type { DocumentModelWire } from '@obiter/contracts'
import {
  collectEditOperations,
  LAST_PARAGRAPH_MESSAGE,
  resolveInsertAnchor,
  storyFlowParagraphIds,
} from './document-edits'
import {
  emptyDraftState,
  isPendingBaselineId,
  type BlockedDraft,
  type DraftSlot,
  type DraftState,
} from './document-draft-state'
import { emphasisSlotKey, slotLabel } from './document-save-slots'
import { sectionDraftFields } from './document-section-format'
import { editableStories } from './document-model-text'
import {
  conflictingStructure,
  structuralKindNoun,
} from './document-structure-conflicts'

export {
  emptyDraftState,
  isPendingBaselineId,
  PENDING_BASELINE_PREFIX,
} from './document-draft-state'
export type {
  BlockedDraft,
  DraftSlot,
  DraftState,
  TrackedRejection,
} from './document-draft-state'

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
  const editable = editableStories(model)
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

  // A runless paragraph with typed text pending is replaced by an insert plus
  // a delete in the same batch (`emptyReplacements`), so a structure anchored
  // to it would anchor a paragraph the batch removes — the writer would drop
  // the insertion silently. Block it instead.
  const replacedEmptyAnchors = new Set(
    editable
      .flatMap((story) => story.paragraphs)
      .filter(
        (paragraph) =>
          paragraph.runs.length === 0 &&
          (state.extraRuns[paragraph.id] ?? []).some(
            (run) => (state.drafts[run.id] ?? run.text).length > 0,
          ),
      )
      .map((paragraph) => paragraph.id),
  )
  const paragraphWires = new Map(
    editable
      .flatMap((story) => story.paragraphs)
      .map((paragraph) => [paragraph.id, paragraph]),
  )
  for (const structure of state.structures) {
    const deletedAnchor =
      keep.deletedParagraphIds.includes(structure.paragraphId) ||
      replacedEmptyAnchors.has(structure.paragraphId)
    const missingTarget =
      structure.kind === 'cross-reference' &&
      (!paragraphIds.has(structure.targetParagraphId) ||
        keep.deletedParagraphIds.includes(structure.targetParagraphId))
    // Same-paragraph pairs a writer cannot compose (a link rewrites whole
    // runs; a field splice poisons its run for a second splice) are held back
    // like `replacedEmptyAnchors`, so they are disclosed rather than failing
    // the whole request.
    const wire = paragraphWires.get(structure.paragraphId)
    const conflicting = wire
      ? conflictingStructure(
          wire,
          keep.drafts,
          keep.extraRuns[structure.paragraphId] ?? [],
          keep.structures,
          structure,
        )
      : undefined
    if (
      !paragraphIds.has(structure.paragraphId) ||
      deletedAnchor ||
      missingTarget ||
      conflicting
    ) {
      blocked.push({
        slot: {
          kind: 'structure',
          key: `structure:${structure.id}`,
          id: structure.id,
          structureKind: structure.kind,
        },
        reason: missingTarget
          ? 'The paragraph this references is no longer in the document.'
          : deletedAnchor
            ? 'The paragraph this was placed after is marked for deletion.'
            : conflicting
              ? `The paragraph already holds a ${structuralKindNoun(conflicting.kind)} this cannot be combined with.`
              : 'The paragraph this was placed in is no longer in the document.',
        label: slotLabel({
          kind: 'structure',
          key: `structure:${structure.id}`,
          id: structure.id,
          structureKind: structure.kind,
        }),
      })
      continue
    }
    keep.structures.push(structure)
    covered.push({
      kind: 'structure',
      key: `structure:${structure.id}`,
      id: structure.id,
      structureKind: structure.kind,
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

  // A restored or constructed draft state can hold deletions that would empty
  // an editable story — the body's last paragraph, or a header/footer's only
  // one. Block the deletes inside each emptied story rather than send a batch
  // the server must reject; the client guard already stops the editor creating
  // this state, so this is the save-plan safety net.
  const emptiedDeletes = new Set<string>()
  for (const story of editable) {
    if (
      storyFlowParagraphIds(story, keep.inserts, keep.deletedParagraphIds)
        .length < 1
    ) {
      for (const paragraph of story.paragraphs) {
        if (keep.deletedParagraphIds.includes(paragraph.id)) {
          emptiedDeletes.add(paragraph.id)
        }
      }
    }
  }
  if (emptiedDeletes.size > 0) {
    for (const slot of covered) {
      if (slot.kind !== 'delete' || !emptiedDeletes.has(slot.paragraphId)) {
        continue
      }
      blocked.push({
        slot,
        reason: LAST_PARAGRAPH_MESSAGE,
        label: 'a deletion',
      })
    }
    covered = covered.filter(
      (slot) => slot.kind !== 'delete' || !emptiedDeletes.has(slot.paragraphId),
    )
    keep.deletedParagraphIds = keep.deletedParagraphIds.filter(
      (id) => !emptiedDeletes.has(id),
    )
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
      keep.structures,
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
