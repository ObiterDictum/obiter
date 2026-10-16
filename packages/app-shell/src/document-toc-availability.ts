/**
 * The typed reasons a table-of-contents draft cannot save, shared between
 * the ribbon's disabled state and the save partition. Both surfaces must
 * agree: when the writer would refuse an insertion, a stale draft
 * resurfacing after reload has to be partitioned out of the batch rather
 * than fail the whole save.
 */

import {
  DOCUMENT_EDIT_TABLE_OF_CONTENTS_MAX_ENTRIES,
  type DocumentChangeWire,
  type DocumentParagraphWire,
  type DocumentStyleWire,
} from '@obiter/contracts'
import { paragraphOutlineLevel } from '@obiter/ooxml'

/**
 * The wire-level twin of the writer's `hasTrackedChanges`: the parser
 * strips tracked-change elements out of a paragraph's preserved fragments
 * and records each as a change wire keyed by the containing paragraph id,
 * so a fragment scan cannot see them — the change list can.
 */
export function wireHasTrackedChanges(
  paragraph: DocumentParagraphWire,
  changes: readonly DocumentChangeWire[],
): boolean {
  return changes.some((change) => change.paragraphId === paragraph.id)
}

/**
 * The same outline-level rule the writer's `tableOfContentsEntries`
 * applies through `paragraphOutlineLevel`: `w:outlineLvl` 0-8 declared on
 * the paragraph or inherited along its `w:basedOn` chain — built-in
 * `Heading<n>` ids included — with only the first three levels collected.
 * A generated `TOC<n>` entry style never carries one, so an inserted field
 * cannot list itself.
 */
export function isTableOfContentsHeading(
  paragraph: DocumentParagraphWire,
  styles: readonly DocumentStyleWire[],
): boolean {
  const level = paragraphOutlineLevel(paragraph, styles)
  return level !== undefined && level < 3
}

/**
 * The typed block for a paragraph that cannot anchor a table of contents,
 * derived purely from wire facts the ribbon and the save partition both
 * hold. The writer adds a stronger version on the source XML — a paragraph
 * inside `w:sdt` content fails there even though no wire fact names its
 * container — so this set stays a subset the two surfaces can share.
 */
export function tableOfContentsAnchorBlock(
  paragraph: DocumentParagraphWire,
  cellParagraphIds: ReadonlySet<string>,
  changes: readonly DocumentChangeWire[],
): string | undefined {
  if (cellParagraphIds.has(paragraph.id)) {
    return 'A table cell cannot hold a table of contents'
  }
  if (
    paragraph.preservedXmlFragments.some(
      (fragment) =>
        /^<w:pPr\b/u.test(fragment) && /<w:sectPr\b/u.test(fragment),
    )
  ) {
    return 'A section-ending paragraph cannot hold a table of contents'
  }
  if (wireHasTrackedChanges(paragraph, changes)) {
    return 'This paragraph contains tracked changes a table of contents cannot record.'
  }
  return undefined
}

/**
 * The typed block for a heading set the writer would refuse: an empty
 * list, a list past the contract cap, or a heading that cannot hold the
 * `PAGEREF` bookmark because it carries tracked changes. Callers pass the
 * heading wires of their view — stored paragraphs only, since a pending
 * insert cannot carry a stored bookmark.
 */
export function tableOfContentsHeadingsBlock(
  headings: readonly DocumentParagraphWire[],
  changes: readonly DocumentChangeWire[],
): string | undefined {
  if (headings.length === 0) {
    return 'The document has no headings a table of contents can list.'
  }
  if (headings.length > DOCUMENT_EDIT_TABLE_OF_CONTENTS_MAX_ENTRIES) {
    return `The document has more than ${String(DOCUMENT_EDIT_TABLE_OF_CONTENTS_MAX_ENTRIES)} headings for a table of contents.`
  }
  if (headings.some((heading) => wireHasTrackedChanges(heading, changes))) {
    return 'This paragraph contains tracked changes a table of contents cannot record.'
  }
  return undefined
}
