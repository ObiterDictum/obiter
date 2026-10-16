import {
  PAGE_STORY_KINDS,
  type DocumentModelWire,
  type DocumentParagraphWire,
} from '@obiter/contracts'
import {
  emptyDraftState,
  isPendingBaselineId,
  type BlockedDraft,
  type DraftSlot,
  type DraftState,
} from './document-draft-state'
import { documentStory, editableStories } from './document-model-text'
import {
  batchParagraphDeletions,
  LAST_PARAGRAPH_MESSAGE,
} from './document-edits'
import { storyTableCellIds } from './document-page-tables'
import { footnoteNoteParagraphId } from './document-structural-drafts'
import { partitionFormatDrafts } from './document-format-partition'
import { emphasisSlotKey, slotLabel } from './document-save-slots'
import { resolveInsertAnchor } from './document-story-flow'
import {
  conflictingStructure,
  structuralKindNoun,
} from './document-structure-conflicts'
import {
  isTableOfContentsHeading,
  tableOfContentsAnchorBlock,
  tableOfContentsHeadingsBlock,
} from './document-toc-availability'

/**
 * A tracked-change decision the save can send: the group's persisted `w:id`s
 * resolved to the current version's wire change ids, plus any empty
 * tracked-insert shells to remove in the same decision.
 */
export type ResolvedRejection = {
  key: string
  ooxmlIds: string[]
  changeIds: string[]
  removeParagraphIds?: string[]
}

export type SavePartition = {
  /** The draft state restricted to slots the loaded model can address. */
  keep: DraftState
  /** Slots the request covers. A successful save clears exactly these. */
  covered: DraftSlot[]
  /** Slots that cannot be addressed against this model, so they are not sent. */
  blocked: BlockedDraft[]
  /**
   * Pending-baseline reversals no model names yet. Not sent and not blocked,
   * but unsaved work the workspace must not report itself saved over.
   */
  pending: number
  /** Tracked-change decisions resolved against the loaded model's changes. */
  rejections: ResolvedRejection[]
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
export function partitionDraftState(
  model: DocumentModelWire,
  state: DraftState,
): SavePartition {
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

  // A pending footnote's note text is held as extra runs under a paragraph
  // id only the painted model carries, so the paragraph-id check cannot
  // address it: the runs live and die with their structure and are decided
  // once the structures loop has run.
  const noteParagraphById = new Map(
    state.structures
      .filter((item) => item.kind === 'footnote')
      .map((item) => [footnoteNoteParagraphId(item), item.id]),
  )
  const deferredNoteRuns: { paragraphId: string; structureId: string }[] = []

  for (const [paragraphId, runs] of Object.entries(state.extraRuns)) {
    // A persisted draft from before empty lists were dropped may still carry
    // one; it holds nothing, so it is not a slot.
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

  // The batch's resolved deletions, computed once so the partition and every
  // painted surface read the same answer (`batchParagraphDeletions`):
  // `applied` is the marks minus the deletions the emptied-story guard
  // refuses, and `effective` adds the runless paragraphs a pending
  // replacement deletes implicitly — no draft marks those, but the writer's
  // `deletedIds` collects their `delete_paragraph` ops all the same. A check
  // reading only `keep.deletedParagraphIds` would pass a structure, a heading
  // or a reference target the writer then refuses.
  const deletions = batchParagraphDeletions(
    model,
    keep.inserts,
    keep.deletedParagraphIds,
    keep.extraRuns,
    keep.drafts,
  )
  if (deletions.emptied.size > 0) {
    // A restored or constructed draft state can hold deletions that would
    // empty an editable story — the body's last paragraph, or a
    // header/footer's only one. Block them rather than send a batch the
    // server must reject; the client guard already stops the editor creating
    // this state, so this is the save-plan safety net.
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
  // Why each blocked structure was held back, so the deferred note text can
  // disclose the same reason rather than blaming a missing anchor paragraph.
  const blockedStructureReasons = new Map<string, string>()
  // The table-of-contents facts the shared refusal predicate reads, computed
  // lazily so a save holding no such draft does not re-parse the tables. The
  // heading set is the painted view restricted to stored paragraphs: a
  // paragraph deleted earlier in the batch is gone, and a `set_paragraph_style`
  // the same batch carries is already applied — the writer sees both when it
  // captures entries, so a freshly styled heading must count.
  let tocFacts:
    | { cellIds: ReadonlySet<string>; headings: DocumentParagraphWire[] }
    | undefined
  const tableOfContentsFacts = () => {
    const story = documentStory(model)
    tocFacts ??= {
      cellIds: storyTableCellIds(story),
      headings: (story?.paragraphs ?? []).filter((paragraph) => {
        if (batchDeletions.has(paragraph.id)) return false
        const pendingStyle = state.format.paragraphStyles[paragraph.id]
        const effective = { ...paragraph }
        if (pendingStyle === null) delete effective.styleId
        else if (pendingStyle !== undefined) effective.styleId = pendingStyle
        return isTableOfContentsHeading(effective, model.styles)
      }),
    }
    return tocFacts
  }
  for (const structure of state.structures) {
    const deletedAnchor = batchDeletions.has(structure.paragraphId)
    const missingTarget =
      structure.kind === 'cross-reference' &&
      (!paragraphIds.has(structure.targetParagraphId) ||
        batchDeletions.has(structure.targetParagraphId))
    // A footnote's reference lives in the body alone: an anchor in any other
    // editable story is a placement the writer must reject, so it is blocked
    // here rather than sent to fail. A page number carries the same rule
    // against a note-story anchor — the `PAGE` field only resolves in the
    // body, a header or a footer.
    const anchorStoryKind = paragraphStoryKind.get(structure.paragraphId)
    const nonBodyAnchor =
      (structure.kind === 'footnote' ||
        structure.kind === 'table-of-contents') &&
      anchorStoryKind !== undefined &&
      anchorStoryKind !== 'document'
    const nonPageAnchor =
      structure.kind === 'page-number' &&
      anchorStoryKind !== undefined &&
      !PAGE_STORY_KINDS.has(anchorStoryKind)
    // Same-paragraph pairs a writer cannot compose (a link rewrites whole
    // runs; a field splice poisons its run for a second splice) are held back
    // like `replacedEmptyAnchors`, so they are disclosed rather than failing
    // the whole request.
    const wire = paragraphWires.get(structure.paragraphId)
    // A reloaded table-of-contents draft is refused for every reason the
    // ribbon would refuse the insertion now: the shared wire-level predicate
    // keeps the two surfaces from drifting, and anything it cannot see — an
    // anchor inside `w:sdt` content — stays the writer's last line.
    const tableOfContentsBlock =
      structure.kind === 'table-of-contents' && wire !== undefined
        ? (tableOfContentsAnchorBlock(
            wire,
            tableOfContentsFacts().cellIds,
            model.changes,
          ) ??
          tableOfContentsHeadingsBlock(
            tableOfContentsFacts().headings,
            model.changes,
          ))
        : undefined
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
      nonBodyAnchor ||
      nonPageAnchor ||
      tableOfContentsBlock ||
      conflicting
    ) {
      const reason = nonBodyAnchor
        ? structure.kind === 'table-of-contents'
          ? 'A table of contents can only be placed in the body.'
          : 'A footnote can only be placed in the body.'
        : nonPageAnchor
          ? 'A page number needs a page of its own: the body, a header or a footer.'
          : missingTarget
            ? 'The paragraph this references is no longer in the document.'
            : deletedAnchor
              ? 'The paragraph this was placed after is marked for deletion.'
              : (tableOfContentsBlock ??
                (conflicting
                  ? `The paragraph already holds a ${structuralKindNoun(conflicting.kind)} this cannot be combined with.`
                  : 'The paragraph this was placed in is no longer in the document.'))
      blockedStructureReasons.set(structure.id, reason)
      blocked.push({
        slot: {
          kind: 'structure',
          key: `structure:${structure.id}`,
          id: structure.id,
          structureKind: structure.kind,
        },
        reason,
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

  // The note text deferred above joins the save only when its footnote
  // structure does — the `insert_footnote` operation carries it — and is
  // blocked with the same honest reason when the structure could not go.
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
