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

export type TableOfAuthoritiesFacts = TableOfAuthoritiesFactSet & {
  fields: ReadonlyMap<string, TableOfAuthoritiesField>
}

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
  offset: number | null
  selectionActive: boolean
  selectionRange: ParagraphRange | null
  trackChanges: boolean
  structures: readonly StructuralDraft[]
  baseUnavailable: string | undefined
  inTableCell: boolean
  anchorWire: DocumentParagraphWire | undefined
  cellParagraphIds: ReadonlySet<string>
  conflictWith: (candidate: StructuralPlacement) => string | undefined
  toaFacts: TableOfAuthoritiesFacts
  drafts: Record<string, string>
  extraRuns: ExtraRuns
  deletedParagraphIds: ReadonlySet<string>
  format: FormatDrafts
  breaks: readonly BreakDraft[]
  inserts: readonly LocalInsert[]
  setStructures: SetStructures
}) {
  const story = model ? documentStory(model) : undefined
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
