import type { DocumentModelWire, DocumentTextRunWire } from '@obiter/contracts'
import {
  editableParagraph,
  editableParagraphs,
  editableStories,
  editableStoryOf,
  paragraphPlainText,
} from './document-model-text'
import {
  resolveInsertAnchor,
  storyFlowParagraphIds,
  type LocalInsert,
} from './document-story-flow'
import { isNoteStory, noteEntryResolver } from './document-note-guard'
import { noteEntryGroups } from './document-page-notes'
import {
  collectEditOperations,
  replacedEmptyParagraphIds,
} from './document-edit-operations'
import { emptyFormatDrafts, type FormatDrafts } from './document-format-edits'

export {
  flowIds,
  flowParagraphIds,
  insertPlainText,
  insertRuns,
  removeInsert,
  resolveInsertAnchor,
  storyFlowParagraphIds,
} from './document-story-flow'
export type { LocalInsert } from './document-story-flow'
export {
  collectEditOperations,
  compactRunProperties,
  replacedEmptyParagraphIds,
  runPropertiesFromFragments,
  sameRunProperties,
} from './document-edit-operations'
export type { RunEditProperties } from './document-edit-operations'
export type { BreakDraft } from './document-draft-state'

/** The one user-facing reason a final-paragraph deletion is refused. */
export const LAST_PARAGRAPH_MESSAGE =
  'A document must contain at least one paragraph.'

/** The same reason scoped to a single footnote or endnote entry. */
export const LAST_NOTE_PARAGRAPH_MESSAGE =
  'A note must contain at least one paragraph.'

/** The reason a pending structure's folded paragraph cannot be deleted: it is
 * removed with its insertion, not by deleting a paragraph. */
export const PENDING_STRUCTURE_MESSAGE =
  'A pending insertion is removed with Undo, not Delete paragraph.'

/** The refusal a paragraph-deletion request can report: `last-paragraph` is
 * the story-level invariant, `last-note-paragraph` the same rule scoped to a
 * single footnote or endnote entry. */
export type ParagraphDeletionRefusal = 'last-paragraph' | 'last-note-paragraph'

/** The outcome a paragraph-deletion request reports to the editor. A refusal is
 * typed so callers translate it rather than matching an English message, and so
 * the last-paragraph invariant has one name across the ribbon, the deletion
 * operation and the save plan. */
export type ParagraphDeletionOutcome =
  | { status: 'deleted'; selectId: string | null }
  | { status: 'refused'; reason: ParagraphDeletionRefusal; selectId: null }

/** Why deleting `paragraphId` is refused, or null when the effective document
 * still keeps at least one paragraph. `flowParagraphIds` is the single
 * derivation of that effective flow: it counts stored paragraphs, adds pending
 * inserts and drops paragraphs already marked for deletion, so the ribbon, the
 * deletion operation and the save plan cannot diverge on what remains. */
export function paragraphDeletionRefusal(
  model: DocumentModelWire,
  inserts: readonly LocalInsert[],
  deletedParagraphIds: readonly string[],
  paragraphId: string,
): ParagraphDeletionRefusal | null {
  // The invariant holds inside the story the paragraph belongs to: a header
  // with no block-level child is as invalid as an empty body. A pending
  // insert's story is the one its anchor chain resolves to.
  const insert = inserts.find((item) => item.clientId === paragraphId)
  const anchorId = insert
    ? resolveInsertAnchor(
        insert,
        new Map(inserts.map((item) => [item.clientId, item])),
        new Set(editableParagraphs(model).map((item) => item.id)),
      )
    : paragraphId
  const story = editableStoryOf(model, anchorId)
  const order = storyFlowParagraphIds(story, inserts, deletedParagraphIds)
  if (!order.includes(paragraphId)) return null
  if (isNoteStory(story)) {
    // The invariant also holds inside each note entry: a `w:footnote` with no
    // `w:p` child is invalid, so deleting the last surviving paragraph of an
    // entry is refused even while the story still has others. An insert joins
    // the entry its anchor resolves into, so it counts as a survivor.
    const entryIndex = noteEntryResolver(
      story,
      inserts,
      new Set(editableParagraphs(model).map((item) => item.id)),
    )
    const entry = entryIndex(paragraphId)
    if (entry !== -1) {
      const survivors = order.filter((id) => entryIndex(id) === entry)
      return survivors.length <= 1 ? 'last-note-paragraph' : null
    }
  }
  return order.length <= 1 ? 'last-paragraph' : null
}

/**
 * Maps each pending delete that would leave an editable story — or a note
 * entry inside one — without a surviving paragraph to the reason the save
 * plan blocks it. `inserts`/`deletedParagraphIds` are the batch's kept
 * values, so a kept insert anchored inside an entry counts as a survivor.
 * The client guard already stops the editor creating this state; this is
 * the same rule restated for a restored or constructed draft.
 */
export function emptiedParagraphDeletes(
  model: DocumentModelWire,
  inserts: readonly LocalInsert[],
  deletedParagraphIds: readonly string[],
): Map<string, string> {
  const deletes = new Map<string, string>()
  const realIds = new Set(editableParagraphs(model).map((item) => item.id))
  for (const story of editableStories(model)) {
    if (storyFlowParagraphIds(story, inserts, deletedParagraphIds).length < 1) {
      for (const paragraph of story.paragraphs) {
        if (deletedParagraphIds.includes(paragraph.id)) {
          deletes.set(paragraph.id, LAST_PARAGRAPH_MESSAGE)
        }
      }
    }
    if (!isNoteStory(story)) continue
    // The same rule inside each note entry: a `w:footnote` or `w:endnote`
    // whose surviving `w:p` count would drop to zero cannot be saved, so
    // the deletes that empty it are blocked like an emptied story.
    const groups = noteEntryGroups(story)
    const flow = storyFlowParagraphIds(story, inserts, deletedParagraphIds)
    const entryIndex = noteEntryResolver(story, inserts, realIds)
    for (const [index, group] of groups.entries()) {
      if (group.length === 0) continue
      if (flow.some((id) => entryIndex(id) === index)) continue
      for (const id of group) {
        if (deletedParagraphIds.includes(id)) {
          deletes.set(id, LAST_NOTE_PARAGRAPH_MESSAGE)
        }
      }
    }
  }
  return deletes
}

/**
 * The deleted sets a batch resolves to, computed once so every surface reads
 * the same answer instead of deriving its own piece of it.
 *
 * `emptied` names the marks the emptied-story guard refuses, keyed to its
 * reason. `applied` is the marks the save will actually write:
 * `deletedParagraphIds` minus those refusals — a refused mark keeps its
 * paragraph painted and addressable. `effective` adds the runless paragraphs
 * a pending replacement deletes implicitly (`replacedEmptyParagraphIds`):
 * no draft marks them, but the writer's `deletedIds` collects their
 * `delete_paragraph` ops all the same, so a structural check that reads only
 * the marks disagrees with the writer.
 *
 * Surfaces asking "does this paragraph still paint or still hold text" read
 * `applied`; surfaces asking "is this paragraph gone after the batch" read
 * `effective`.
 */
export type BatchParagraphDeletions = {
  /** The marks the emptied-story guard refuses, keyed to the refusal reason. */
  emptied: ReadonlyMap<string, string>
  /** The deletions the batch will write: marks minus the refused ones. */
  applied: ReadonlySet<string>
  /** Everything the writer treats as gone: `applied` plus implicit replaces. */
  effective: ReadonlySet<string>
}

export function batchParagraphDeletions(
  model: DocumentModelWire,
  inserts: readonly LocalInsert[],
  deletedParagraphIds: readonly string[],
  extraRuns: Record<string, DocumentTextRunWire[]>,
  drafts: Record<string, string>,
): BatchParagraphDeletions {
  const emptied = emptiedParagraphDeletes(model, inserts, deletedParagraphIds)
  const applied = new Set(deletedParagraphIds.filter((id) => !emptied.has(id)))
  const effective = new Set(applied)
  for (const id of replacedEmptyParagraphIds(
    editableStories(model).flatMap((story) => story.paragraphs),
    extraRuns,
    drafts,
  )) {
    effective.add(id)
  }
  return { emptied, applied, effective }
}

export function isDraftDirty(
  model: DocumentModelWire,
  drafts: Record<string, string>,
  inserts: LocalInsert[],
  deletedParagraphIds: string[],
  extraRuns: Record<string, DocumentTextRunWire[]> = {},
  format: FormatDrafts = emptyFormatDrafts,
) {
  return (
    collectEditOperations(
      model,
      drafts,
      inserts,
      deletedParagraphIds,
      extraRuns,
      format,
    ).length > 0
  )
}

export function selectedParagraphLength(
  model: DocumentModelWire,
  paragraphId: string | null,
) {
  if (!paragraphId) return 0
  const paragraph = editableParagraph(model, paragraphId)
  return paragraph ? paragraphPlainText(paragraph).length : 0
}

export function downloadPlainText(filename: string, text: string) {
  downloadBlob(
    `${filename.replace(/\.[^.]+$/u, '')}.txt`,
    new Blob([text], { type: 'text/plain;charset=utf-8' }),
  )
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
