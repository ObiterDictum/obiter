import type {
  DocumentParagraphWire,
  DocumentTextRunWire,
} from '@obiter/contracts'

import { escapeXmlText } from './parts/overlay'
import { W14_NAMESPACE } from './structure-xml'
import type { TableOfAuthoritiesEntry } from './table-of-authorities-entries'
import {
  FIELD_BEGIN_RUN,
  FIELD_SEPARATE_RUN,
  pageReferenceRunWires,
  pageReferenceXml,
  TAB_RUN,
} from './table-of-contents-xml'
import { wordRunInnerTextXml } from './text-run-edit'

/** An entry plus the `_ToA` bookmark names its page references resolve. */
export type ToaEntry = TableOfAuthoritiesEntry & { bookmarks: string[] }

/**
 * `\h` hyperlinks each entry to its authority, `\c "1"` collects category 1
 * — cases — the only category the citation grammar produces.
 */
export const TOA_INSTRUCTION = ' TOA \\h \\c "1" '
/** The heading the generated field's first result paragraph carries. */
export const TOA_HEADING = 'Table of Cases'
const HIDDEN_RUN_PROPERTIES = '<w:rPr><w:vanish/></w:rPr>'
const FIELD_BEGIN_FRAGMENT = '<w:fldChar w:fldCharType="begin"/>'
const FIELD_END_FRAGMENT = '<w:fldChar w:fldCharType="end"/>'

/**
 * The instruction a `TA` mark stores: `\l` the long citation (the matched
 * text), `\s` the short form (the same, there is no shorter cite), `\c 1`
 * the cases category. Word writes the field hidden — the three runs carry
 * `w:vanish` so the mark is metadata, not text.
 */
export function tableAuthorityMarkXml(citation: string) {
  const escaped = escapeXmlText(citation)
  const instruction = `<w:instrText xml:space="preserve"> TA \\l "${escaped}" \\s "${escaped}" \\c 1 </w:instrText>`
  return [
    `<w:r>${HIDDEN_RUN_PROPERTIES}${FIELD_BEGIN_FRAGMENT}</w:r>`,
    `<w:r>${HIDDEN_RUN_PROPERTIES}${instruction}</w:r>`,
    `<w:r>${HIDDEN_RUN_PROPERTIES}${FIELD_END_FRAGMENT}</w:r>`,
  ].join('')
}

/** The run wires a reparse of `tableAuthorityMarkXml`'s output produces. */
export function tableAuthorityMarkWires(
  nextId: () => string,
  citation: string,
): DocumentTextRunWire[] {
  const escaped = escapeXmlText(citation)
  const hidden = (fragments: string[]): DocumentTextRunWire => ({
    id: nextId(),
    text: '',
    preservedXmlFragments: [HIDDEN_RUN_PROPERTIES, ...fragments],
  })
  return [
    hidden([FIELD_BEGIN_FRAGMENT]),
    hidden([
      `<w:instrText xml:space="preserve"> TA \\l "${escaped}" \\s "${escaped}" \\c 1 </w:instrText>`,
    ]),
    hidden([FIELD_END_FRAGMENT]),
  ]
}

/**
 * The table's heading paragraph as it serialises: `TOAHeading` styling, and
 * the `TOA` field's begin, instruction and separator before the heading
 * text — the first result paragraph of the field whose `end` opens the
 * tail paragraph after the last entry.
 */
export function toaHeadingParagraphXml(paraId: string) {
  const runs = [
    FIELD_BEGIN_RUN,
    `<w:r><w:instrText xml:space="preserve">${TOA_INSTRUCTION}</w:instrText></w:r>`,
    FIELD_SEPARATE_RUN,
    `<w:r>${wordRunInnerTextXml('w', TOA_HEADING)}</w:r>`,
  ].join('')
  return `<w:p xmlns:w14="${W14_NAMESPACE}" w14:paraId="${paraId}"><w:pPr><w:pStyle w:val="TOAHeading"/></w:pPr>${runs}</w:p>`
}

/** The wire counterpart of `toaHeadingParagraphXml`. */
export function toaHeadingParagraphWire(
  nextId: () => string,
  paraId: string,
): DocumentParagraphWire {
  const field = (fragments: string[]): DocumentTextRunWire => ({
    id: nextId(),
    text: '',
    preservedXmlFragments: fragments,
  })
  return {
    id: `para-w14-${paraId}`,
    sourceParaId: paraId,
    styleId: 'TOAHeading',
    runs: [
      field(['<w:fldChar w:fldCharType="begin"/>']),
      field([
        `<w:instrText xml:space="preserve">${TOA_INSTRUCTION}</w:instrText>`,
      ]),
      field(['<w:fldChar w:fldCharType="separate"/>']),
      { id: nextId(), text: TOA_HEADING, preservedXmlFragments: [] },
    ],
    preservedXmlFragments: ['<w:pPr><w:pStyle w:val="TOAHeading"/></w:pPr>'],
  }
}

/**
 * One entry paragraph as it serialises: `TableofAuthorities` styling with
 * the right dot-leader tab, the citation text, a tab and a `PAGEREF` field
 * per citing paragraph's `_ToA` bookmark — a comma-separated page list
 * when several paragraphs cite the same authority.
 */
export function toaEntryParagraphXml(
  entry: ToaEntry,
  paraId: string,
  tabPosition: number,
) {
  const references = entry.bookmarks
    .map((bookmark) => pageReferenceXml(bookmark))
    .join('<w:r><w:t xml:space="preserve">, </w:t></w:r>')
  const runs = [
    `<w:r>${wordRunInnerTextXml('w', entry.citation)}</w:r>`,
    TAB_RUN,
    references,
  ].join('')
  return `<w:p xmlns:w14="${W14_NAMESPACE}" w14:paraId="${paraId}">${entryPropertiesFragment(tabPosition)}${runs}</w:p>`
}

/** The wire counterpart of `toaEntryParagraphXml`. */
export function toaEntryParagraphWire(
  nextId: () => string,
  entry: ToaEntry,
  paraId: string,
  tabPosition: number,
): DocumentParagraphWire {
  const references = entry.bookmarks.flatMap((bookmark, index) => [
    ...(index === 0
      ? []
      : [{ id: nextId(), text: ', ', preservedXmlFragments: [] }]),
    ...pageReferenceRunWires(nextId, bookmark),
  ])
  return {
    id: `para-w14-${paraId}`,
    sourceParaId: paraId,
    styleId: 'TableofAuthorities',
    runs: [
      { id: nextId(), text: entry.citation, preservedXmlFragments: [] },
      { id: nextId(), text: '', preservedXmlFragments: ['<w:tab/>'] },
      ...references,
    ],
    preservedXmlFragments: [entryPropertiesFragment(tabPosition)],
  }
}

function entryPropertiesFragment(tabPosition: number) {
  return `<w:pPr><w:pStyle w:val="TableofAuthorities"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${String(tabPosition)}"/></w:tabs></w:pPr>`
}
