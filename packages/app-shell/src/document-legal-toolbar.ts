import {
  definedTermBookmarkName,
  type DocumentModelWire,
  type DocumentParagraphWire,
} from '@obiter/contracts'
import type { BreakDraft } from './document-draft-state'
import type { FormatDrafts } from './document-format-types'
import type { ParagraphRange } from './document-format-toolbar'
import { documentStory, editableParagraph } from './document-model-text'
import { blockText, type ExtraRuns } from './document-word-edits'
import { resolveInsertAnchor, type LocalInsert } from './document-story-flow'
import type { StructuralPlacement } from './document-structure-conflicts'
import {
  structuralDraftSchema,
  type StructuralDraft,
} from './document-structural-drafts'
import {
  tableOfAuthoritiesAnchorBlock,
  tableOfAuthoritiesEntriesBlock,
  tableOfAuthoritiesMarkBlock,
  tableOfAuthoritiesUpdateBlock,
  type TableOfAuthoritiesFactSet,
  type TableOfAuthoritiesField,
} from './document-toa-availability'
import type { StructuralInsertOutcome } from './document-structure-toolbar'

type SetStructures = (
  update: (current: StructuralDraft[]) => StructuralDraft[],
) => void

/**
 * The citations the painted flow reports over stored body paragraphs —
 * the same set the save partition's facts describe, so the ribbon's
 * disabled reason and the partition's block read one answer. `fields`
 * maps each stored `TOA` field's head paragraph id to the range it
 * covers, so the update control can name the field under the caret.
 */
export type TableOfAuthoritiesFacts = TableOfAuthoritiesFactSet & {
  fields: ReadonlyMap<string, TableOfAuthoritiesField>
}

/**
 * The References ribbon's legal-document controls: the defined-term mark
 * over a single-paragraph selection and the table of authorities at the
 * caret. Extracted from `document-structure-toolbar`, which was at its
 * source ceiling: the rules are the same shape — a stored body anchor,
 * an honest disabled reason, a schema-checked draft — but the inputs they
 * read differ (a selection for the mark, the whole citation set for the
 * field), so they own their own module.
 */
export function documentLegalToolbar({
  model,
  paragraphId,
  offset,
  selectionActive,
  selectionRange,
  trackChanges,
  structures,
  baseUnavailable,
  inTableCell,
  anchorWire,
  cellParagraphIds,
  conflictWith,
  toaFacts,
  drafts,
  extraRuns,
  deletedParagraphIds,
  format,
  breaks,
  inserts,
  setStructures,
}: {
  model: DocumentModelWire | undefined
  paragraphId: string | null
  /** The caret's effective-text offset, the TOA draft's splice point. */
  offset: number | null
  selectionActive: boolean
  /** The selection's range when it sits inside exactly one paragraph. */
  selectionRange: ParagraphRange | null
  trackChanges: boolean
  /** Held drafts: mark conflicts read what is already placed. */
  structures: readonly StructuralDraft[]
  /** The shared caret-level block the structure toolbar computes once. */
  baseUnavailable: string | undefined
  inTableCell: boolean
  /** The caret paragraph's stored wire, when the anchor is stored. */
  anchorWire: DocumentParagraphWire | undefined
  cellParagraphIds: ReadonlySet<string>
  /** The shared same-paragraph conflict predicate the toolbar derives. */
  conflictWith: (candidate: StructuralPlacement) => string | undefined
  /** The citations the painted flow reports over stored body paragraphs. */
  toaFacts: TableOfAuthoritiesFacts
  drafts: Record<string, string>
  extraRuns: ExtraRuns
  /** Paragraphs marked for deletion — a field one covers cannot update. */
  deletedParagraphIds: ReadonlySet<string>
  /** Pending format state the update block reads like the partition does. */
  format: FormatDrafts
  breaks: readonly BreakDraft[]
  inserts: readonly LocalInsert[]
  setStructures: SetStructures
}) {
  const story = model ? documentStory(model) : undefined
  // A defined-term mark is a range mark over the words that bind the term,
  // so it shares the link's selection rules and body-only anchor.
  const definedTermUnavailable = trackChanges
    ? 'A defined-term mark is not recorded as a tracked change'
    : !selectionRange
      ? selectionActive
        ? 'Select text within one paragraph to mark'
        : 'Select the words that bind the term'
      : !story?.paragraphs.some(
            (paragraph) => paragraph.id === selectionRange.paragraphId,
          )
        ? model && editableParagraph(model, selectionRange.paragraphId)
          ? 'Only the document body can hold a defined-term mark'
          : 'Save the new paragraph before marking a term in it'
        : conflictWith({
            kind: 'defined-term',
            paragraphId: selectionRange.paragraphId,
            from: selectionRange.from,
            to: selectionRange.to,
          })
  // A table of authorities is a body splice like a table of contents —
  // plus the mark pass it runs: a document with no citation the grammar
  // collects drafts a field the writer must refuse, and a citing paragraph
  // that cannot hold the `TA` mark or `_ToA` bookmark holds the whole
  // draft, matching the shared refusal predicates the save partition runs.
  const tableOfAuthoritiesUnavailable =
    baseUnavailable ??
    (inTableCell
      ? 'A table cell cannot hold a table of authorities'
      : offset === null || !paragraphId
        ? 'Place the cursor in the paragraph text to insert a table of authorities'
        : !anchorWire
          ? undefined
          : (tableOfAuthoritiesAnchorBlock(
              anchorWire,
              cellParagraphIds,
              model?.changes ?? [],
            ) ??
            tableOfAuthoritiesEntriesBlock(
              toaFacts.entries,
              toaFacts.occurrences.length,
              toaFacts.citingWires,
              model?.changes ?? [],
            ) ??
            tableOfAuthoritiesMarkBlock(
              toaFacts.occurrences,
              toaFacts.citingWires,
              drafts,
              extraRuns,
              structures,
            ) ??
            conflictWith({
              kind: 'table-of-authorities',
              paragraphId,
              offset,
            })))
  // A stored field updates when the caret sits anywhere inside it — the
  // head's `begin` is what the draft names — through the same shared
  // refusal chain the save partition runs, so a refresh the save would
  // hold is refused here with the same reason.
  const storyParagraphs = story?.paragraphs ?? []
  const wiresById = new Map(
    storyParagraphs.map((paragraph) => [paragraph.id, paragraph]),
  )
  const caretField = paragraphId
    ? [...toaFacts.fields.values()].find((field) =>
        field.paragraphIds.includes(paragraphId),
      )
    : undefined
  const insertById = new Map(inserts.map((insert) => [insert.clientId, insert]))
  const realIds = new Set(storyParagraphs.map((paragraph) => paragraph.id))
  // "Already queued" means a refresh draft that would itself survive the
  // save partition: the block is evaluated without the queued-refresh gate
  // first, so a draft the save would hold — the field deleted, pending
  // edits inside it — does not report the field claimed.
  const updateFieldBlock = caretField
    ? tableOfAuthoritiesUpdateBlock({
        field: caretField,
        fieldWires: caretField.paragraphIds.flatMap((id) => {
          const wire = wiresById.get(id)
          return wire === undefined ? [] : [wire]
        }),
        facts: toaFacts,
        changes: model?.changes ?? [],
        deletions: deletedParagraphIds,
        drafts,
        extraRuns,
        format,
        breaks,
        insertAnchors: new Set(
          inserts.map((insert) =>
            resolveInsertAnchor(insert, insertById, realIds),
          ),
        ),
        structures,
        queuedRefresh: false,
      })
    : undefined
  const refreshQueued =
    caretField !== undefined &&
    updateFieldBlock === undefined &&
    structures.some(
      (item) =>
        item.kind === 'table-of-authorities-refresh' &&
        item.paragraphId === caretField.headId,
    )
  const tableOfAuthoritiesUpdateUnavailable = trackChanges
    ? 'A table of authorities update is not recorded as a tracked change'
    : !caretField
      ? 'Place the cursor in a table of authorities to update it'
      : (updateFieldBlock ??
        (refreshQueued
          ? 'This table of authorities is already queued to update.'
          : undefined))

  return {
    definedTermUnavailable,
    tableOfAuthoritiesUnavailable,
    tableOfAuthoritiesUpdateUnavailable,
    markDefinedTerm(): StructuralInsertOutcome {
      if (definedTermUnavailable || !selectionRange || !model) {
        return {
          inserted: false,
          reason: definedTermUnavailable ?? 'No text selected',
        }
      }
      // The bookmark name is derived from the covered words, here and again
      // by the writer at save time; a selection that cannot name a term —
      // no word characters, or longer than the bookmark-name cap — is refused
      // now rather than at save.
      const covered = blockText(
        model,
        { drafts, extraRuns, inserts: [], deletedParagraphIds: [] },
        selectionRange.paragraphId,
      ).slice(selectionRange.from, selectionRange.to)
      if (definedTermBookmarkName(covered) === null) {
        return {
          inserted: false,
          reason:
            'That selection cannot name a term: it needs words the bookmark can hold.',
        }
      }
      // `marked` pins the term to the words selected now: the save
      // partition refuses to write the bookmark if the same slice no
      // longer reads them.
      const draft: StructuralDraft = {
        id: crypto.randomUUID(),
        kind: 'defined-term',
        paragraphId: selectionRange.paragraphId,
        from: selectionRange.from,
        to: selectionRange.to,
        marked: covered,
      }
      if (!structuralDraftSchema.safeParse(draft).success) {
        return {
          inserted: false,
          reason: 'That mark cannot be held as a draft.',
        }
      }
      setStructures((current) => [...current, draft])
      return { inserted: true }
    },
    insertTableOfAuthorities(): StructuralInsertOutcome {
      if (tableOfAuthoritiesUnavailable || !paragraphId || offset === null) {
        return {
          inserted: false,
          reason: tableOfAuthoritiesUnavailable ?? 'No anchor',
        }
      }
      const draft: StructuralDraft = {
        id: crypto.randomUUID(),
        kind: 'table-of-authorities',
        paragraphId,
        offset,
      }
      if (!structuralDraftSchema.safeParse(draft).success) {
        return {
          inserted: false,
          reason: 'That table of authorities cannot be held as a draft.',
        }
      }
      setStructures((current) => [...current, draft])
      return { inserted: true }
    },
    updateTableOfAuthorities(): StructuralInsertOutcome {
      if (tableOfAuthoritiesUpdateUnavailable || !caretField) {
        return {
          inserted: false,
          reason:
            tableOfAuthoritiesUpdateUnavailable ?? 'No table of authorities',
        }
      }
      const draft: StructuralDraft = {
        id: crypto.randomUUID(),
        kind: 'table-of-authorities-refresh',
        paragraphId: caretField.headId,
      }
      if (!structuralDraftSchema.safeParse(draft).success) {
        return {
          inserted: false,
          reason: 'That update cannot be held as a draft.',
        }
      }
      setStructures((current) => [...current, draft])
      return { inserted: true }
    },
  }
}
