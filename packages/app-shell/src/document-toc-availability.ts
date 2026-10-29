import {
  DOCUMENT_EDIT_TABLE_OF_CONTENTS_MAX_ENTRIES,
  type DocumentChangeWire,
  type DocumentParagraphWire,
  type DocumentStyleWire,
} from '@obiter/contracts'
import { paragraphOutlineLevel } from '@obiter/ooxml'

export function wireHasTrackedChanges(
  paragraph: DocumentParagraphWire,
  changes: readonly DocumentChangeWire[],
): boolean {
  return changes.some((change) => change.paragraphId === paragraph.id)
}

export function isTableOfContentsHeading(
  paragraph: DocumentParagraphWire,
  styles: readonly DocumentStyleWire[],
): boolean {
  const level = paragraphOutlineLevel(paragraph, styles)
  return level !== undefined && level < 3
}

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
