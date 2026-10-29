import type {
  DocumentModelWire,
  DocumentStoryWire,
  DocumentTextRunWire,
} from '@obiter/contracts'
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

export const LAST_PARAGRAPH_MESSAGE =
  'A document must contain at least one paragraph.'

export const LAST_NOTE_PARAGRAPH_MESSAGE =
  'A note must contain at least one paragraph.'

export const PENDING_STRUCTURE_MESSAGE =
  'A pending insertion is removed with Undo, not Delete paragraph.'

export const FIELD_BOUNDARY_MESSAGE =
  'This paragraph belongs to a stored field that can only be removed as a whole.'

export const FIELD_METADATA_MESSAGE =
  'This document was loaded without its stored-field data, so paragraph removal is not supported.'

export type ParagraphDeletionRefusal =
  'last-paragraph' | 'last-note-paragraph' | 'field-boundary' | 'field-metadata'

function storyFieldMetadataKnown(story: DocumentStoryWire): boolean {
  return (
    Array.isArray(story.fields) &&
    Array.isArray(story.unanchoredFieldParagraphIds)
  )
}

export type ParagraphDeletionOutcome =
  | { status: 'deleted'; selectId: string | null }
  | { status: 'refused'; reason: ParagraphDeletionRefusal; selectId: null }

export function fieldBoundaryRefusals(
  model: DocumentModelWire,
  removedIds: ReadonlySet<string>,
): Map<string, string> {
  const refusals = new Map<string, string>()
  if (removedIds.size === 0) return refusals
  for (const story of model.stories) {
    if (!storyFieldMetadataKnown(story)) {
      const stored = new Set(story.paragraphs.map((item) => item.id))
      for (const id of removedIds) {
        if (stored.has(id)) refusals.set(id, FIELD_METADATA_MESSAGE)
      }
      continue
    }
    for (const id of removedIds) {
      if (story.unanchoredFieldParagraphIds.includes(id)) {
        refusals.set(id, FIELD_BOUNDARY_MESSAGE)
      }
    }
    for (const field of story.fields) {
      const covered = field.boundaryIds.filter((id) => removedIds.has(id))
      if (
        covered.length > 0 &&
        (covered.length < field.boundaryIds.length || !field.boundariesAnchored)
      ) {
        for (const id of covered) {
          refusals.set(id, FIELD_BOUNDARY_MESSAGE)
        }
      }
    }
  }
  return refusals
}

export function fieldBoundarySplitIds(
  model: DocumentModelWire,
  removedIds: ReadonlySet<string>,
): boolean {
  return fieldBoundaryRefusals(model, removedIds).size > 0
}

export function paragraphDeletionRefusal(
  model: DocumentModelWire,
  inserts: readonly LocalInsert[],
  deletedParagraphIds: readonly string[],
  paragraphId: string,
): ParagraphDeletionRefusal | null {
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
  if (
    story !== undefined &&
    story.paragraphs.some((paragraph) => paragraph.id === paragraphId) &&
    !storyFieldMetadataKnown(story)
  ) {
    return 'field-metadata'
  }
  if (
    fieldBoundarySplitIds(model, new Set([...deletedParagraphIds, paragraphId]))
  ) {
    return 'field-boundary'
  }
  if (isNoteStory(story)) {
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

export type BatchParagraphDeletions = {
  emptied: ReadonlyMap<string, string>
  split: ReadonlyMap<string, string>
  implicit: ReadonlySet<string>
  applied: ReadonlySet<string>
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
  const marked = new Set(deletedParagraphIds.filter((id) => !emptied.has(id)))
  const implicit = replacedEmptyParagraphIds(
    editableStories(model).flatMap((story) => story.paragraphs),
    extraRuns,
    drafts,
    model,
  )
  const split = fieldBoundaryRefusals(model, new Set([...marked, ...implicit]))
  const applied = new Set([...marked].filter((id) => !split.has(id)))
  const effective = new Set(applied)
  for (const id of implicit) {
    if (!split.has(id)) effective.add(id)
  }
  return { emptied, split, implicit, applied, effective }
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
