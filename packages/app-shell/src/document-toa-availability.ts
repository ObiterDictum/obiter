/**
 * The typed reasons a table-of-authorities draft cannot save, shared
 * between the ribbon's disabled state and the save partition — the same
 * arrangement the table-of-contents predicates keep. Both surfaces must
 * agree: when the writer would refuse an insertion, a stale draft
 * resurfacing after reload has to be partitioned out of the batch rather
 * than fail the whole save.
 */

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

/**
 * The wire-level twin of the writer's anchor checks: a cell or content
 * paragraph cannot take the paragraph-level splice, a section-ending
 * paragraph cannot split, and tracked changes cannot record the field. The
 * writer adds a stronger check on the source XML — an anchor inside `w:sdt`
 * content fails there even though no wire fact names its container — so
 * this set stays a subset the two surfaces can share.
 */
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

/**
 * The typed block for a citation set the writer would refuse: no citation
 * to list, more distinct citations than the contract's entry ceiling, more
 * occurrences than the mark ceiling, or a citing paragraph that cannot
 * hold the `TA` mark and `_ToA` bookmark because it carries tracked
 * changes. `citingWires` are the stored wires of the paragraphs the
 * entries cite — the writer marks and bookmarks them, so they face the
 * same tracked-change rule the anchor does.
 */
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

/**
 * The typed block for a `TA` mark that cannot be spliced: every occurrence
 * the field captures is a zero-width splice into the citing wire at the
 * citation's end offset, so it answers to the shared conflict rules — a
 * mark inside a stored `w:hyperlink`, across a pending draft's range, or
 * on a placement a held structure already owns holds the whole draft, the
 * way the writer's refusal would. `citingWires` carries the stored wires
 * the mark pass touches so the predicate reads the same text and
 * fragments the splice does.
 */
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

/**
 * One stored `TOA` field, as the parser paired it on the wire. `headId` is
 * the paragraph holding the field's `begin` — the paragraph an update
 * operation names — `resultIds` are the paragraphs carrying the field's
 * generated result, and `paragraphIds` adds the tail paragraph holding
 * the `end` character, which an update keeps. `rangeReplaceable` is the
 * parser's proof the stored shape is the one the in-place rewrite
 * composes.
 */
export type TableOfAuthoritiesField = DocumentFieldWire

/**
 * The stored body's `TOA` fields, keyed by head-paragraph id, taken from
 * the field metadata the parser emitted rather than re-derived here: the
 * wire's paragraph and run fragments lose element parentage and sibling
 * order, so only the parser's element walk can pair begins and ends and
 * prove the shape the writer needs. Every consumer — the ribbon's update
 * control, the fold, the save partition — reads this one map so they can
 * never disagree about where a stored field is or whether it is safe to
 * rewrite.
 */
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

/** The shared citation-set shape the predicates and the ribbon read. */
export type TableOfAuthoritiesFactSet = {
  occurrences: AuthorityOccurrence[]
  entries: TableOfAuthoritiesEntry[]
  citingWires: DocumentParagraphWire[]
}

/**
 * The citations a save batch captures, over the stored body paragraphs
 * that survive the batch's deletions — the set the writer's `deletedIds`
 * exclusion collects — with pending drafts, extra runs and pending
 * paragraph styles applied so the set names the same text and styles the
 * writer's `wire.text`/`wire.styleId` hold after the batch's style ops
 * land. Computed lazily: a save holding no TOA draft does not scan the
 * document. `fields` maps the body's `TOA` fields for the update path and
 * the ribbon's update control.
 */
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

/**
 * The stored wire restyled the way the batch's `set_paragraph_style` ops
 * leave it: a pending style id lands on `styleId`, `null` clears it. The
 * citation collector skips generated-result styles, so the effective
 * style — not the stored one — decides what the field captures.
 */
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

/**
 * The whole refusal chain a reloaded `TOA` draft answers at the save
 * partition: the anchor-level block, then the citation-set block, then
 * the mark-level conflicts a citing paragraph can carry — the same
 * predicates in the same order the ribbon runs them, so a draft the
 * ribbon would refuse today is held back with the same reason rather
 * than reaching the writer.
 */
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

/**
 * The typed block for an `update_table_of_authorities` draft, shared the
 * way the insert predicates are: a refresh rewrites every paragraph from
 * the field's `begin` paragraph up to — not including — the one holding
 * its `end`, so it answers to the pending-state checks the writer's
 * overlap walk performs. A deleted or tracked field paragraph, any text,
 * run, style, format, break or insert edit landing inside the result
 * range, or an earlier structure anchored there holds the refresh. The
 * citation and mark checks then re-run over the occurrences outside the
 * replaced range — the set the writer will mark and list.
 *
 * `insertAnchors` carries each kept insert's resolved anchor paragraph so
 * the predicate can refuse an insert that would land inside the replaced
 * range; callers without insert state pass an empty set.
 *
 * `queuedRefresh` is the caller's answer to "is a refresh draft for this
 * field already going to save" — computed the way the partition decides
 * survivability, so the ribbon and the save agree on whether the control
 * is already claimed.
 */
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
        // A refresh draft on this field is the `queuedRefresh` gate's
        // concern — it names the head, which the range covers, so counting
        // it here would read every queued refresh as a pending edit.
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
