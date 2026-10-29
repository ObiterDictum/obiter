import type {
  DocumentParagraphWire,
  DocumentTextRunWire,
} from '@obiter/contracts'

import { escapeXmlText } from './parts/overlay'
import {
  attributeValue,
  isWord,
  WORD_NAMESPACE,
  type XmlElement,
} from './parts/xml-elements'
import { W14_NAMESPACE } from './structure-xml'
import type { TableOfContentsEntry } from './table-of-contents-entries'
import { wordRunInnerTextXml } from './text-run-edit'

export type TocEntry = TableOfContentsEntry & { bookmark: string }

const TOC_INSTRUCTION = ' TOC \\o "1-3" \\u '
export const TOC_FIELD_END_RUN = '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
export const FIELD_BEGIN_RUN = '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
export const FIELD_SEPARATE_RUN =
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
export const TAB_RUN = '<w:r><w:tab/></w:r>'

export const FALLBACK_TAB_POSITION_TWIPS = 9026

export function entryParagraphXml(
  entry: TocEntry,
  paraId: string,
  first: boolean,
  tabPosition: number,
) {
  const runs = [
    ...(first
      ? [FIELD_BEGIN_RUN, tocInstructionXml(), FIELD_SEPARATE_RUN]
      : []),
    `<w:r>${wordRunInnerTextXml('w', entry.text)}</w:r>`,
    TAB_RUN,
    pageReferenceXml(entry.bookmark),
  ].join('')
  return `<w:p xmlns:w14="${W14_NAMESPACE}" w14:paraId="${paraId}">${entryPropertiesFragment(entry.level, tabPosition)}${runs}</w:p>`
}

export function entryParagraphWire(
  nextId: () => string,
  entry: TocEntry,
  paraId: string,
  first: boolean,
  tabPosition: number,
): DocumentParagraphWire {
  const field = (fragments: string[]): DocumentTextRunWire => ({
    id: nextId(),
    text: '',
    preservedXmlFragments: fragments,
  })
  const runs: DocumentTextRunWire[] = [
    ...(first
      ? [
          field(['<w:fldChar w:fldCharType="begin"/>']),
          field([tocInstructionFragment()]),
          field(['<w:fldChar w:fldCharType="separate"/>']),
        ]
      : []),
    { id: nextId(), text: entry.text, preservedXmlFragments: [] },
    field(['<w:tab/>']),
    ...pageReferenceRunWires(nextId, entry.bookmark),
  ]
  return {
    id: `para-w14-${paraId}`,
    sourceParaId: paraId,
    styleId: `TOC${String(entry.level)}`,
    runs,
    preservedXmlFragments: [entryPropertiesFragment(entry.level, tabPosition)],
  }
}

export function sectionColumnWidthTwips(
  elements: readonly XmlElement[],
  after: number,
) {
  const section = elements.find(
    (element) => isWord(element, 'sectPr') && element.start > after,
  )
  if (!section) return FALLBACK_TAB_POSITION_TWIPS
  const inside = elements.filter(
    (element) => element.start > section.start && element.end <= section.end,
  )
  const pageSize = inside.find((element) => isWord(element, 'pgSz'))
  const margins = inside.find((element) => isWord(element, 'pgMar'))
  const width = twips(pageSize, 'w')
  const left = twips(margins, 'left')
  const right = twips(margins, 'right')
  if (width === undefined || left === undefined || right === undefined) {
    return FALLBACK_TAB_POSITION_TWIPS
  }
  return width - left - right
}

export function pageReferenceRunWires(
  nextId: () => string,
  bookmark: string,
): DocumentTextRunWire[] {
  return [
    {
      id: nextId(),
      text: '',
      preservedXmlFragments: ['<w:fldChar w:fldCharType="begin"/>'],
    },
    {
      id: nextId(),
      text: '',
      preservedXmlFragments: [
        `<w:instrText xml:space="preserve"> PAGEREF ${escapeXmlText(bookmark)} </w:instrText>`,
      ],
    },
    {
      id: nextId(),
      text: '',
      preservedXmlFragments: ['<w:fldChar w:fldCharType="separate"/>'],
    },
    { id: nextId(), text: '', preservedXmlFragments: [] },
    {
      id: nextId(),
      text: '',
      preservedXmlFragments: ['<w:fldChar w:fldCharType="end"/>'],
    },
  ]
}

function entryPropertiesFragment(level: number, tabPosition?: number) {
  const position =
    tabPosition === undefined
      ? ''
      : `<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${String(tabPosition)}"/></w:tabs>`
  return `<w:pPr><w:pStyle w:val="TOC${String(level)}"/>${position}</w:pPr>`
}

function tocInstructionXml() {
  return `<w:r>${tocInstructionFragment()}</w:r>`
}

function tocInstructionFragment() {
  return `<w:instrText xml:space="preserve">${TOC_INSTRUCTION}</w:instrText>`
}

export function pageReferenceXml(bookmark: string) {
  return [
    FIELD_BEGIN_RUN,
    `<w:r><w:instrText xml:space="preserve"> PAGEREF ${escapeXmlText(bookmark)} </w:instrText></w:r>`,
    FIELD_SEPARATE_RUN,
    '<w:r><w:t xml:space="preserve"></w:t></w:r>',
    TOC_FIELD_END_RUN,
  ].join('')
}

function twips(element: XmlElement | undefined, name: string) {
  if (!element) return undefined
  const raw = attributeValue(element, WORD_NAMESPACE, name)
  const value = raw === undefined ? Number.NaN : Number.parseInt(raw, 10)
  return Number.isInteger(value) && value > 0 ? value : undefined
}
