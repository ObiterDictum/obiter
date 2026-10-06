import type { DocumentModelWire, DocumentTextRunWire } from '@obiter/contracts'
import {
  editableParagraph,
  editableParagraphs,
  editableStoryOf,
  paragraphPlainText,
} from './document-model-text'
import {
  resolveInsertAnchor,
  storyFlowParagraphIds,
  type LocalInsert,
} from './document-story-flow'
import { collectEditOperations } from './document-edit-operations'
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
  runPropertiesFromFragments,
  sameRunProperties,
} from './document-edit-operations'
export type { RunEditProperties } from './document-edit-operations'
export type { BreakDraft } from './document-draft-state'

/** The one user-facing reason a final-paragraph deletion is refused. */
export const LAST_PARAGRAPH_MESSAGE =
  'A document must contain at least one paragraph.'

/** The outcome a paragraph-deletion request reports to the editor. A refusal is
 * typed so callers translate it rather than matching an English message, and so
 * the last-paragraph invariant has one name across the ribbon, the deletion
 * operation and the save plan. */
export type ParagraphDeletionOutcome =
  | { status: 'deleted'; selectId: string | null }
  | { status: 'refused'; reason: 'last-paragraph'; selectId: null }

/** Why deleting `paragraphId` is refused, or null when the effective document
 * still keeps at least one body paragraph. `flowParagraphIds` is the single
 * derivation of that effective flow: it counts stored paragraphs, adds pending
 * inserts and drops paragraphs already marked for deletion, so the ribbon, the
 * deletion operation and the save plan cannot diverge on what remains. */
export function paragraphDeletionRefusal(
  model: DocumentModelWire,
  inserts: readonly LocalInsert[],
  deletedParagraphIds: readonly string[],
  paragraphId: string,
): 'last-paragraph' | null {
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
  const order = storyFlowParagraphIds(
    editableStoryOf(model, anchorId),
    inserts,
    deletedParagraphIds,
  )
  if (!order.includes(paragraphId)) return null
  return order.length <= 1 ? 'last-paragraph' : null
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
