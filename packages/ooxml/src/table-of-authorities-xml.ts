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

export type ToaEntry = TableOfAuthoritiesEntry & { bookmarks: string[] }

const TOA_INSTRUCTION = ' TOA \\h \\c "1" '
const TOA_HEADING = 'Table of Cases'
const HIDDEN_RUN_PROPERTIES = '<w:rPr><w:vanish/></w:rPr>'
const FIELD_BEGIN_FRAGMENT = '<w:fldChar w:fldCharType="begin"/>'
const FIELD_END_FRAGMENT = '<w:fldChar w:fldCharType="end"/>'

export function tableAuthorityMarkXml(citation: string) {
  const escaped = escapeXmlText(citation)
  const instruction = `<w:instrText xml:space="preserve"> TA \\l "${escaped}" \\s "${escaped}" \\c 1 </w:instrText>`
  return [
    `<w:r>${HIDDEN_RUN_PROPERTIES}${FIELD_BEGIN_FRAGMENT}</w:r>`,
    `<w:r>${HIDDEN_RUN_PROPERTIES}${instruction}</w:r>`,
    `<w:r>${HIDDEN_RUN_PROPERTIES}${FIELD_END_FRAGMENT}</w:r>`,
  ].join('')
}

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

export function toaHeadingParagraphXml(paraId: string) {
  const runs = [
    FIELD_BEGIN_RUN,
    `<w:r><w:instrText xml:space="preserve">${TOA_INSTRUCTION}</w:instrText></w:r>`,
    FIELD_SEPARATE_RUN,
    `<w:r>${wordRunInnerTextXml('w', TOA_HEADING)}</w:r>`,
  ].join('')
  return `<w:p xmlns:w14="${W14_NAMESPACE}" w14:paraId="${paraId}"><w:pPr><w:pStyle w:val="TOAHeading"/></w:pPr>${runs}</w:p>`
}

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
