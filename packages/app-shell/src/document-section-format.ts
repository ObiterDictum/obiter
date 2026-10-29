import type { DocumentModelWire } from '@obiter/contracts'
import {
  activeSectionXml,
  insertPropertyChild,
  patchSectionPropertiesXml,
  stripPropertyChild,
} from '@obiter/ooxml'
import { documentSectionXml } from './document-page-layout'
import { xmlNumber, xmlTagAttrs } from './document-page-units'
import type { BreakDraft } from './document-edits'
import type { FormatDrafts, SectionDraft } from './document-format-types'

export const SECTION_MARGINS_OPTIONS = [
  {
    value: 'normal',
    label: 'Normal',
    margins: {
      top: 1440,
      right: 1440,
      bottom: 1440,
      left: 1440,
      header: 720,
      footer: 720,
    },
  },
  {
    value: 'narrow',
    label: 'Narrow',
    margins: {
      top: 720,
      right: 720,
      bottom: 720,
      left: 720,
      header: 720,
      footer: 720,
    },
  },
  {
    value: 'moderate',
    label: 'Moderate',
    margins: {
      top: 1440,
      right: 1080,
      bottom: 1440,
      left: 1080,
      header: 720,
      footer: 720,
    },
  },
  {
    value: 'wide',
    label: 'Wide',
    margins: {
      top: 1440,
      right: 2880,
      bottom: 1440,
      left: 2880,
      header: 720,
      footer: 720,
    },
  },
] as const

export type SectionMarginsKind =
  (typeof SECTION_MARGINS_OPTIONS)[number]['value'] | ''

export const PAGE_SIZE_OPTIONS = [
  { value: 'a4', label: 'A4', width: 11_906, height: 16_838 },
  { value: 'letter', label: 'Letter', width: 12_240, height: 15_840 },
  { value: 'legal', label: 'Legal', width: 12_240, height: 20_160 },
] as const

export type PageSizeKind = (typeof PAGE_SIZE_OPTIONS)[number]['value'] | ''

export type SectionFormatState = {
  marginsKind: SectionMarginsKind
  orientation: 'portrait' | 'landscape'
  pageSizeKind: PageSizeKind
}

export function hasSectionDraft(section: SectionDraft): boolean {
  return (
    section.margins !== undefined ||
    section.orientation !== undefined ||
    section.pageSize !== undefined
  )
}

export function sectionDraftFields(section: SectionDraft) {
  if (!hasSectionDraft(section)) return undefined
  return {
    ...(section.margins !== undefined ? { margins: section.margins } : {}),
    ...(section.orientation !== undefined
      ? { orientation: section.orientation }
      : {}),
    ...(section.pageSize !== undefined ? { pageSize: section.pageSize } : {}),
  }
}

export function sectionFormatState(
  model: DocumentModelWire,
  section: SectionDraft,
): SectionFormatState {
  const fields = sectionDraftFields(section)
  const base = documentSectionXml(model)
  const xml = fields
    ? patchSectionPropertiesXml(base || '<w:sectPr/>', fields)
    : base
  const size = xmlTagAttrs(xml, 'pgSz')
  const width = xmlNumber(size, 'w')
  const height = xmlNumber(size, 'h')
  return {
    marginsKind: readMarginsKind(xmlTagAttrs(xml, 'pgMar')),
    orientation:
      width !== undefined && height !== undefined && width > height
        ? 'landscape'
        : 'portrait',
    pageSizeKind: readPageSizeKind(width, height),
  }
}

export function setSectionMarginsDraft(
  format: FormatDrafts,
  kind: SectionMarginsKind,
): FormatDrafts {
  const option = SECTION_MARGINS_OPTIONS.find((item) => item.value === kind)
  if (!option) return format
  return {
    ...format,
    section: { ...format.section, margins: { ...option.margins } },
  }
}

export function setSectionPageSizeDraft(
  format: FormatDrafts,
  model: DocumentModelWire,
  kind: PageSizeKind,
): FormatDrafts {
  const option = PAGE_SIZE_OPTIONS.find((item) => item.value === kind)
  if (!option) return format
  const orientation = sectionFormatState(model, format.section).orientation
  return {
    ...format,
    section: {
      ...format.section,
      pageSize: orientSize(
        { width: option.width, height: option.height },
        orientation,
      ),
      orientation,
    },
  }
}

export function toggleSectionOrientation(
  format: FormatDrafts,
  model: DocumentModelWire,
): FormatDrafts {
  const orientation =
    sectionFormatState(model, format.section).orientation === 'landscape'
      ? 'portrait'
      : 'landscape'
  const pageSize = format.section.pageSize
  return {
    ...format,
    section: {
      ...format.section,
      orientation,
      ...(pageSize ? { pageSize: orientSize(pageSize, orientation) } : {}),
    },
  }
}

export function paintSectionFragments(
  fragments: readonly string[],
  section: SectionDraft,
): string[] {
  const fields = sectionDraftFields(section)
  if (!fields) return [...fragments]
  const patch = patchSectionPropertiesXml('<w:sectPr/>', fields)
  const index = fragments.findIndex((fragment) => /<w:sectPr\b/u.test(fragment))
  if (index === -1) return [...fragments, patch]
  return fragments.map((fragment, fragmentIndex) =>
    fragmentIndex === index
      ? patchSectionPropertiesXml(fragment, fields)
      : fragment,
  )
}

function orientSize(
  size: { width: number; height: number },
  orientation: 'portrait' | 'landscape',
) {
  const low = Math.min(size.width, size.height)
  const high = Math.max(size.width, size.height)
  return orientation === 'landscape'
    ? { width: high, height: low }
    : { width: low, height: high }
}

export function withBreakDrafts(
  model: DocumentModelWire,
  breaks: readonly BreakDraft[],
): DocumentModelWire {
  const sections = breaks.filter((item) => item.kind === 'section')
  if (sections.length === 0) return model
  const byParagraph = new Map<string, BreakDraft[]>()
  for (const item of sections) {
    const list = byParagraph.get(item.paragraphId) ?? []
    list.push(item)
    byParagraph.set(item.paragraphId, list)
  }
  const bodySection = documentSectionXml(model)
  const instruction = bodySection || '<w:sectPr/>'
  return {
    ...model,
    stories: model.stories.map((story) => {
      if (story.kind !== 'document') return story
      return {
        ...story,
        paragraphs: story.paragraphs.map((paragraph) => {
          const list = byParagraph.get(paragraph.id)
          if (!list || list.length === 0) return paragraph
          if (
            paragraph.preservedXmlFragments.some(
              (fragment) => activeSectionXml(fragment).length > 0,
            )
          ) {
            return paragraph
          }
          const index = paragraph.preservedXmlFragments.findIndex((fragment) =>
            /<w:pPr\b/u.test(fragment),
          )
          if (index === -1) {
            return {
              ...paragraph,
              preservedXmlFragments: [
                ...paragraph.preservedXmlFragments,
                breakFragment(instruction),
              ],
            }
          }
          return {
            ...paragraph,
            preservedXmlFragments: paragraph.preservedXmlFragments.map(
              (fragment, fragmentIndex) =>
                fragmentIndex === index
                  ? insertPropertyChild(
                      stripPropertyChild(fragment, 'sectPr'),
                      'sectPr',
                      instruction,
                    )
                  : fragment,
            ),
          }
        }),
      }
    }),
  }
}

function breakFragment(section: string) {
  return `<w:pPr>${section}</w:pPr>`
}

function readMarginsKind(attrs: string | undefined): SectionMarginsKind {
  if (attrs === undefined) return ''
  const read = {
    top: xmlNumber(attrs, 'top'),
    right: xmlNumber(attrs, 'right'),
    bottom: xmlNumber(attrs, 'bottom'),
    left: xmlNumber(attrs, 'left'),
    header: xmlNumber(attrs, 'header'),
    footer: xmlNumber(attrs, 'footer'),
  }
  const option = SECTION_MARGINS_OPTIONS.find(
    (item) =>
      item.margins.top === read.top &&
      item.margins.right === read.right &&
      item.margins.bottom === read.bottom &&
      item.margins.left === read.left &&
      item.margins.header === read.header &&
      item.margins.footer === read.footer,
  )
  return option?.value ?? ''
}

function readPageSizeKind(
  width: number | undefined,
  height: number | undefined,
): PageSizeKind {
  if (width === undefined || height === undefined) return ''
  const low = Math.min(width, height)
  const high = Math.max(width, height)
  const option = PAGE_SIZE_OPTIONS.find(
    (item) =>
      Math.min(item.width, item.height) === low &&
      Math.max(item.width, item.height) === high,
  )
  return option?.value ?? ''
}
