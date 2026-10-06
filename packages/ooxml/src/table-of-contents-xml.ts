import type {
  DocumentParagraphWire,
  DocumentTextRunWire,
} from '@obiter/contracts'

import { allocateModelId } from './model-paragraph-edits'
import type { OoxmlDocument } from './model'
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

/** A captured entry plus the `_Toc` bookmark its page reference names. */
export type TocEntry = TableOfContentsEntry & { bookmark: string }

export const TOC_INSTRUCTION = ' TOC \\o "1-3" \\u '
export const TOC_FIELD_END_RUN =
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
const FIELD_BEGIN_RUN = '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
const FIELD_SEPARATE_RUN =
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
const TAB_RUN = '<w:r><w:tab/></w:r>'

// The right-aligned dot-leader tab stop an entry line carries, positioned at
// the section's column width when the part records one and at the synthetic
// default page's width otherwise. Paint lays the tab out by its own rules;
// the stored position is for Word.
const FALLBACK_TAB_POSITION_TWIPS = 9026

/**
 * One entry paragraph as it serialises: `TOC<level>` styling with the
 * dot-leader tab, the captured heading text, a tab and the `PAGEREF` field
 * to the heading's bookmark. The first entry additionally opens the `TOC`
 * field — begin, instruction, separator — so the whole result sits inside
 * one field whose `end` opens the paragraph after the last entry.
 */
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

/**
 * The wire counterpart of `entryParagraphXml` — the run list a reparse of
 * the same element produces, so the pending model and the stored model
 * paint alike.
 */
export function entryParagraphWire(
  document: OoxmlDocument,
  entry: TocEntry,
  paraId: string,
  first: boolean,
  tabPosition: number,
): DocumentParagraphWire {
  const id = () => allocateModelId(document, 'text-edit')
  const field = (fragments: string[]): DocumentTextRunWire => ({
    id: id(),
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
    { id: id(), text: entry.text, preservedXmlFragments: [] },
    field(['<w:tab/>']),
    ...pageReferenceRunWires(id, entry.bookmark),
  ]
  return {
    id: `para-w14-${paraId}`,
    sourceParaId: paraId,
    styleId: `TOC${String(entry.level)}`,
    runs,
    preservedXmlFragments: [entryPropertiesFragment(entry.level, tabPosition)],
  }
}

/**
 * The text column width of the section containing `after` — the first
 * `w:sectPr` past it — so the stored dot-leader tab stops at the right
 * margin. Falls back to the synthetic default width when the section
 * carries no page size or margins.
 */
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

/** The five run wires a stored `PAGEREF` field reparses to. */
function pageReferenceRunWires(
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

function pageReferenceXml(bookmark: string) {
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
