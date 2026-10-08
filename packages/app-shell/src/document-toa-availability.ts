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
  type DocumentModelWire,
  type DocumentParagraphWire,
  type DocumentTextRunWire,
} from '@obiter/contracts'
import {
  tableOfAuthoritiesCitations,
  type AuthorityOccurrence,
  type TableOfAuthoritiesEntry,
} from '@obiter/ooxml'

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
 * The citations a save batch captures, over the stored body paragraphs
 * that survive the batch's deletions — the set the writer's `deletedIds`
 * exclusion collects — with pending drafts and extra runs applied so the
 * mark offsets the predicate checks name the same text the writer's
 * `wire.text` holds. Computed lazily: a save holding no TOA draft does
 * not scan the document. `keep` is the partition's surviving draft state,
 * fully populated for text and runs before the structural loop runs.
 */
export function createTableOfAuthoritiesFacts({
  model,
  batchDeletions,
  drafts,
  extraRuns,
}: {
  model: DocumentModelWire
  batchDeletions: ReadonlySet<string>
  drafts: Record<string, string>
  extraRuns: Record<string, readonly DocumentTextRunWire[]>
}) {
  let facts:
    | {
        occurrences: AuthorityOccurrence[]
        entries: TableOfAuthoritiesEntry[]
        citingWires: DocumentParagraphWire[]
      }
    | undefined
  return () => {
    if (facts === undefined) {
      const story = documentStory(model)
      const paragraphs = (story?.paragraphs ?? []).filter(
        (paragraph) => !batchDeletions.has(paragraph.id),
      )
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
      facts = {
        occurrences,
        entries,
        citingWires: paragraphs.filter((paragraph) =>
          citingIds.has(paragraph.id),
        ),
      }
    }
    return facts
  }
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
