import {
  DOCUMENT_EDIT_TABLE_OF_AUTHORITIES_MAX_ENTRIES,
  DOCUMENT_EDIT_TABLE_OF_AUTHORITIES_MAX_OCCURRENCES,
  type DocumentChangeWire,
  type DocumentFieldWire,
  type DocumentModelWire,
  type DocumentParagraphWire,
  type DocumentStoryWire,
  type DocumentTextRunWire,
} from '@obiter/contracts'
import {
  isTableOfAuthoritiesField,
  tableOfAuthoritiesCitations,
  type AuthorityOccurrence,
  type TableOfAuthoritiesEntry,
} from '@obiter/ooxml'

import type { BreakDraft } from './document-draft-state'
import type {
  NumberingDraft,
  ParagraphFormatDraft,
  PendingEmphasis,
} from './document-format-types'
import {
  documentStory,
  effectiveParagraph,
  paragraphPlainText,
} from './document-model-text'
import {
  conflictingStructure,
  structuralKindNoun,
} from './document-structure-conflicts'
import type { StructuralDraft } from './document-structural-drafts'
import { wireHasTrackedChanges } from './document-toc-availability'
import type { ExtraRuns } from './document-word-edits'

export function tableOfAuthoritiesAnchorBlock(
  paragraph: DocumentParagraphWire,
  cellParagraphIds: ReadonlySet<string>,
  changes: readonly DocumentChangeWire[],
): string | undefined {
  if (cellParagraphIds.has(paragraph.id)) {
    return 'A table cell cannot hold a table of authorities'
  }
  if (
    paragraph.preservedXmlFragments.some(
      (fragment) =>
        /^<w:pPr\b/u.test(fragment) && /<w:sectPr\b/u.test(fragment),
    )
  ) {
    return 'A section-ending paragraph cannot hold a table of authorities'
  }
  if (wireHasTrackedChanges(paragraph, changes)) {
    return 'This paragraph contains tracked changes a table of authorities cannot record.'
  }
  return undefined
}

export function tableOfAuthoritiesEntriesBlock(
  entries: readonly TableOfAuthoritiesEntry[],
  occurrenceCount: number,
  citingWires: readonly DocumentParagraphWire[],
  changes: readonly DocumentChangeWire[],
): string | undefined {
  if (entries.length === 0) {
    return 'The document has no citations a table of authorities can list.'
  }
  if (entries.length > DOCUMENT_EDIT_TABLE_OF_AUTHORITIES_MAX_ENTRIES) {
    return `The document has more than ${String(DOCUMENT_EDIT_TABLE_OF_AUTHORITIES_MAX_ENTRIES)} distinct citations for a table of authorities.`
  }
  if (occurrenceCount > DOCUMENT_EDIT_TABLE_OF_AUTHORITIES_MAX_OCCURRENCES) {
    return `The document has more than ${String(DOCUMENT_EDIT_TABLE_OF_AUTHORITIES_MAX_OCCURRENCES)} citation occurrences a table of authorities can mark.`
  }
  if (citingWires.some((wire) => wireHasTrackedChanges(wire, changes))) {
    return 'A citing paragraph contains tracked changes a table of authorities cannot record.'
  }
  return undefined
}

export function tableOfAuthoritiesMarkBlock(
  occurrences: readonly AuthorityOccurrence[],
  citingWires: readonly DocumentParagraphWire[],
  drafts: Record<string, string>,
  extraRuns: ExtraRuns,
  structures: readonly StructuralDraft[],
): string | undefined {
  const wiresById = new Map(citingWires.map((wire) => [wire.id, wire]))
  for (const hit of occurrences) {
    const wire = wiresById.get(hit.paragraphId)
    if (!wire) continue
    const conflict = conflictingStructure(
      wire,
      drafts,
      extraRuns[hit.paragraphId] ?? [],
      structures,
      {
        kind: 'authority-mark',
        paragraphId: hit.paragraphId,
        offset: hit.end,
      },
    )
    if (conflict) {
      return `A citing paragraph already holds a ${structuralKindNoun(conflict.kind)} the citation marks cannot be combined with.`
    }
  }
  return undefined
}

export type TableOfAuthoritiesField = DocumentFieldWire

export function tableOfAuthoritiesFields(
  story: DocumentStoryWire | undefined,
): Map<string, TableOfAuthoritiesField> {
  const fields = new Map<string, TableOfAuthoritiesField>()
  for (const field of story?.fields ?? []) {
    if (isTableOfAuthoritiesField(field.instruction)) {
      fields.set(field.headId, field)
    }
  }
  return fields
}

export type TableOfAuthoritiesFactSet = {
  occurrences: AuthorityOccurrence[]
  entries: TableOfAuthoritiesEntry[]
  citingWires: DocumentParagraphWire[]
}

export function createTableOfAuthoritiesFacts({
  model,
  batchDeletions,
  drafts,
  extraRuns,
  paragraphStyles,
}: {
  model: DocumentModelWire
  batchDeletions: ReadonlySet<string>
  drafts: Record<string, string>
  extraRuns: Record<string, readonly DocumentTextRunWire[]>
  paragraphStyles: Record<string, string | null>
}) {
  let facts:
    | (TableOfAuthoritiesFactSet & {
        fields: Map<string, TableOfAuthoritiesField>
      })
    | undefined
  return () => {
    if (facts === undefined) {
      const story = documentStory(model)
      const storyParagraphs = story?.paragraphs ?? []
      const paragraphs = storyParagraphs
        .filter((paragraph) => !batchDeletions.has(paragraph.id))
        .map((paragraph) => pendingStyled(paragraph, paragraphStyles))
      const { occurrences, entries } = tableOfAuthoritiesCitations(
        paragraphs,
        (paragraph) =>
          paragraphPlainText(
            effectiveParagraph(
              paragraph,
              drafts,
              extraRuns[paragraph.id] ?? [],
            ),
          ),
      )
      const citingIds = new Set(entries.flatMap((entry) => entry.paragraphIds))
      const citingWires = paragraphs.filter((paragraph) =>
        citingIds.has(paragraph.id),
      )
      facts = {
        occurrences,
        entries,
        citingWires,
        fields: tableOfAuthoritiesFields(story),
      }
    }
    return facts
  }
}

function pendingStyled(
  paragraph: DocumentParagraphWire,
  paragraphStyles: Record<string, string | null>,
): DocumentParagraphWire {
  const pending = paragraphStyles[paragraph.id]
  if (pending === undefined) return paragraph
  const wire = { ...paragraph }
  if (pending === null) delete wire.styleId
  else wire.styleId = pending
  return wire
}

export function tableOfAuthoritiesPartitionBlock({
  wire,
  cellParagraphIds,
  changes,
  facts,
  drafts,
  extraRuns,
  structures,
}: {
  wire: DocumentParagraphWire
  cellParagraphIds: ReadonlySet<string>
  changes: readonly DocumentChangeWire[]
  facts: () => {
    occurrences: AuthorityOccurrence[]
    entries: TableOfAuthoritiesEntry[]
    citingWires: DocumentParagraphWire[]
  }
  drafts: Record<string, string>
  extraRuns: ExtraRuns
  structures: readonly StructuralDraft[]
}): string | undefined {
  const anchorBlock = tableOfAuthoritiesAnchorBlock(
    wire,
    cellParagraphIds,
    changes,
  )
  if (anchorBlock) return anchorBlock
  const computed = facts()
  const entriesBlock = tableOfAuthoritiesEntriesBlock(
    computed.entries,
    computed.occurrences.length,
    computed.citingWires,
    changes,
  )
  if (entriesBlock) return entriesBlock
  return tableOfAuthoritiesMarkBlock(
    computed.occurrences,
    computed.citingWires,
    drafts,
    extraRuns,
    structures,
  )
}

export function tableOfAuthoritiesUpdateBlock({
  field,
  fieldWires,
  facts,
  changes,
  deletions,
  drafts,
  extraRuns,
  format,
  breaks,
  insertAnchors,
  structures,
  queuedRefresh,
}: {
  field: TableOfAuthoritiesField
  fieldWires: readonly DocumentParagraphWire[]
  facts: TableOfAuthoritiesFactSet
  changes: readonly DocumentChangeWire[]
  deletions: ReadonlySet<string>
  drafts: Record<string, string>
  extraRuns: ExtraRuns
  format: {
    paragraphStyles: Record<string, string | null>
    numbering: Record<string, NumberingDraft>
    paragraphFormats: Record<string, ParagraphFormatDraft>
    emphasis: readonly PendingEmphasis[]
  }
  breaks: readonly BreakDraft[]
  insertAnchors: ReadonlySet<string>
  structures: readonly StructuralDraft[]
  queuedRefresh: boolean
}): string | undefined {
  const resultIds = new Set(field.resultIds)
  if (!field.rangeReplaceable) {
    return 'This table of authorities cannot be updated in place.'
  }
  if (field.paragraphIds.some((id) => deletions.has(id))) {
    return 'A paragraph this table of authorities covers is marked for deletion.'
  }
  if (fieldWires.some((wire) => wireHasTrackedChanges(wire, changes))) {
    return 'This table of authorities contains tracked changes an update cannot record.'
  }
  if (queuedRefresh) {
    return 'This table of authorities is already queued to update.'
  }
  const resultRunIds = new Set(
    fieldWires
      .filter((wire) => resultIds.has(wire.id))
      .flatMap((wire) => wire.runs.map((run) => run.id)),
  )
  if (
    Object.keys(drafts).some((id) => resultRunIds.has(id)) ||
    Object.keys(extraRuns).some((id) => resultIds.has(id)) ||
    Object.keys(format.paragraphStyles).some((id) => resultIds.has(id)) ||
    Object.keys(format.numbering).some((id) => resultIds.has(id)) ||
    Object.keys(format.paragraphFormats).some((id) => resultIds.has(id)) ||
    format.emphasis.some(
      (item) =>
        (item.paragraphId !== undefined && resultIds.has(item.paragraphId)) ||
        (item.runId !== undefined && resultRunIds.has(item.runId)),
    ) ||
    breaks.some((item) => resultIds.has(item.paragraphId)) ||
    [...insertAnchors].some((id) => resultIds.has(id)) ||
    structures.some(
      (structure) =>
        !(
          structure.kind === 'table-of-authorities-refresh' &&
          structure.paragraphId === field.headId
        ) &&
        (resultIds.has(structure.paragraphId) ||
          (structure.kind === 'cross-reference' &&
            resultIds.has(structure.targetParagraphId))),
    )
  ) {
    return 'Pending edits inside this table of authorities must save before it can update.'
  }
  const occurrences = facts.occurrences.filter(
    (hit) => !resultIds.has(hit.paragraphId),
  )
  const citingIds = new Set(occurrences.map((hit) => hit.paragraphId))
  const citingWires = facts.citingWires.filter((wire) => citingIds.has(wire.id))
  const entries = facts.entries
    .map((entry) => ({
      ...entry,
      paragraphIds: entry.paragraphIds.filter((id) => !resultIds.has(id)),
    }))
    .filter((entry) => entry.paragraphIds.length > 0)
  const entriesBlock = tableOfAuthoritiesEntriesBlock(
    entries,
    occurrences.length,
    citingWires,
    changes,
  )
  if (entriesBlock) return entriesBlock
  return tableOfAuthoritiesMarkBlock(
    occurrences,
    citingWires,
    drafts,
    extraRuns,
    structures,
  )
}
