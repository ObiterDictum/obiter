import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import {
  emptyDraftState,
  hasDraftState,
  planDocumentSave,
} from './document-save-plan'
import { readDocumentDraft, writeDocumentDraft } from './document-draft-store'
import { MapStorage, scope } from './document-draft-store-test-support'
import { emptyFormatDrafts } from './document-format-types'
import { formattedModel } from './document-format-edits'
import { layoutDocument } from './document-page-engine'
import { documentSections, sectionXmlInFragment } from './document-page-layout'
import {
  hasSectionDraft,
  paintSectionFragments,
  sectionDraftFields,
  sectionFormatState,
  setSectionMarginsDraft,
  setSectionPageSizeDraft,
  toggleSectionOrientation,
  withBreakDrafts,
} from './document-section-format'

const NORMAL =
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr>'

describe('section format controls', () => {
  it('reads the effective margins, orientation and page size', () => {
    const state = sectionFormatState(modelWithSection(NORMAL), {})
    expect(state).toEqual({
      marginsKind: 'normal',
      orientation: 'portrait',
      pageSizeKind: 'a4',
    })
  })

  it('returns a custom kind for margins a preset does not match', () => {
    const xml =
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="100"/></w:sectPr>'
    expect(sectionFormatState(modelWithSection(xml), {}).marginsKind).toBe('')
  })

  it('applies a margins preset and a page size in the current orientation', () => {
    const model = modelWithSection(NORMAL)
    const narrow = setSectionMarginsDraft(emptyFormatDrafts, 'narrow')
    expect(narrow.section.margins).toEqual({
      top: 720,
      right: 720,
      bottom: 720,
      left: 720,
      header: 720,
      footer: 720,
    })
    const legal = setSectionPageSizeDraft(narrow, model, 'legal')
    expect(legal.section.pageSize).toEqual({ width: 12_240, height: 20_160 })
    expect(legal.section.orientation).toBe('portrait')
    expect(sectionDraftFields(legal.section)).toEqual({
      margins: narrow.section.margins,
      pageSize: { width: 12_240, height: 20_160 },
      orientation: 'portrait',
    })
  })

  it('flips orientation and swaps an explicit page size with it', () => {
    const model = modelWithSection(NORMAL)
    const withSize = setSectionPageSizeDraft(emptyFormatDrafts, model, 'a4')
    const flipped = toggleSectionOrientation(withSize, model)
    expect(flipped.section.orientation).toBe('landscape')
    expect(flipped.section.pageSize).toEqual({ width: 16_838, height: 11_906 })
    // A draft that carries only an orientation leaves the size to the writer.
    const orientationOnly = toggleSectionOrientation(emptyFormatDrafts, model)
    expect(orientationOnly.section.pageSize).toBeUndefined()
    expect(sectionDraftFields(orientationOnly.section)).toEqual({
      orientation: 'landscape',
    })
  })

  it('paints the pending section into the story fragments', () => {
    const painted = paintSectionFragments([NORMAL], { margins: { top: 720 } })
    expect(painted[0]).toContain('<w:pgMar w:top="720"')
    expect(painted[0]).toContain('w:left="1440"')
    expect(hasSectionDraft({})).toBe(false)
    expect(hasSectionDraft({ margins: null })).toBe(true)
  })
})

describe('section and break save planning', () => {
  it('emits one section operation and covers its slot', () => {
    const state = {
      ...emptyDraftState(),
      format: { ...emptyFormatDrafts, section: { margins: { top: 720 } } },
    }
    const plan = planDocumentSave(modelWithSection(NORMAL), state)
    expect(plan.operations).toEqual([
      { type: 'set_section_properties', margins: { top: 720 } },
    ])
    expect(plan.covered).toEqual([{ kind: 'section', key: 'section' }])
    expect(hasDraftState(state)).toBe(true)
  })

  it('emits page and section breaks and blocks one on a missing paragraph', () => {
    const state = {
      ...emptyDraftState(),
      breaks: [
        { id: 'b1', paragraphId: 'p1', offset: 0, kind: 'page' as const },
        { id: 'b2', paragraphId: 'p1', offset: 0, kind: 'section' as const },
        { id: 'b3', paragraphId: 'gone', offset: 0, kind: 'page' as const },
      ],
    }
    const plan = planDocumentSave(model(['p1']), state)
    expect(plan.operations).toEqual([
      { type: 'insert_break', paragraphId: 'p1', offset: 0, kind: 'page' },
      { type: 'insert_section_break', paragraphId: 'p1' },
    ])
    expect(plan.covered.map((slot) => slot.key)).toEqual([
      'break:b1',
      'break:b2',
    ])
    expect(plan.blocked[0]?.label).toBe('a page break')
  })

  it('round-trips section and break drafts through persistence', () => {
    const storage = new MapStorage()
    const state = {
      ...emptyDraftState(),
      format: {
        ...emptyFormatDrafts,
        section: { orientation: 'landscape' as const },
      },
      breaks: [
        { id: 'b1', paragraphId: 'p1', offset: 2, kind: 'page' as const },
      ],
    }
    expect(
      writeDocumentDraft(storage, scope, {
        baseVersionId: 'ver_1',
        state,
        held: [],
      }),
    ).toBe(true)
    const restored = readDocumentDraft(storage, scope, 'ver_1')
    expect(restored.status).toBe('restored')
    if (restored.status !== 'restored') return
    expect(restored.state.format.section).toEqual({ orientation: 'landscape' })
    expect(restored.state.breaks).toEqual([
      { id: 'b1', paragraphId: 'p1', offset: 2, kind: 'page' },
    ])
  })
})

describe('section pagination', () => {
  it('starts a new page at a section break with that section geometry', () => {
    const p1: DocumentParagraphWire = {
      id: 'p1',
      runs: [{ id: 'p1-r', text: 'First section', preservedXmlFragments: [] }],
      preservedXmlFragments: [
        '<w:pPr><w:sectPr><w:pgSz w:w="8000" w:h="6000"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:pPr>',
      ],
    }
    const model: DocumentModelWire = {
      version: 1,
      stories: [
        {
          partName: 'word/document.xml',
          kind: 'document',
          paragraphs: [p1, paragraph('p2'), paragraph('p3')],
          preservedXmlFragments: [NORMAL],
        },
      ],
      styles: [],
      numbering: [],
      relationships: [],
      preservedXmlFragments: [],
      changes: [],
      comments: [],
    }
    const pages = layoutDocument(model)
    expect(pages).toHaveLength(2)
    expect(pages[0]?.box.widthPx).toBe(533)
    expect(pages[0]?.blocks).toHaveLength(1)
    expect(pages[1]?.box.widthPx).toBe(794)
    expect(pages[1]?.blocks).toHaveLength(2)
  })

  it('reads the live section, not the recorded sectPrChange copy', () => {
    const fragment =
      '<w:pPr><w:sectPr><w:pgSz w:w="8000" w:h="6000"/><w:pgMar w:top="720"/>' +
      '<w:sectPrChange w:id="1"><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440"/></w:sectPr></w:sectPrChange>' +
      '</w:sectPr></w:pPr>'
    expect(sectionXmlInFragment(fragment)).toBe(
      '<w:sectPr><w:pgSz w:w="8000" w:h="6000"/><w:pgMar w:top="720"/></w:sectPr>',
    )
    const withHistory: DocumentModelWire = {
      ...model(['p1', 'p2']),
      stories: [
        {
          partName: 'word/document.xml',
          kind: 'document',
          paragraphs: [
            {
              id: 'p1',
              runs: [
                {
                  id: 'p1-r',
                  text: 'First section',
                  preservedXmlFragments: [],
                },
              ],
              preservedXmlFragments: [fragment],
            },
            paragraph('p2'),
          ],
          preservedXmlFragments: [NORMAL],
        },
      ],
    }
    const pages = layoutDocument(withHistory)
    expect(pages).toHaveLength(2)
    expect(pages[0]?.box.widthPx).toBe(533)
    expect(pages[1]?.box.widthPx).toBe(794)
  })

  it('ignores a section recorded only in a paragraph pPrChange history', () => {
    const fragment =
      '<w:pPr><w:pPrChange w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z">' +
      '<w:pPr><w:sectPr><w:pgSz w:w="8000" w:h="6000"/><w:pgMar w:top="720"/></w:sectPr></w:pPr>' +
      '</w:pPrChange></w:pPr>'
    expect(sectionXmlInFragment(fragment)).toBe('')
    const withHistory: DocumentModelWire = {
      ...model(['p1', 'p2']),
      stories: [
        {
          partName: 'word/document.xml',
          kind: 'document',
          paragraphs: [
            {
              id: 'p1',
              runs: [
                {
                  id: 'p1-r',
                  text: 'Historic section',
                  preservedXmlFragments: [],
                },
              ],
              preservedXmlFragments: [fragment],
            },
            paragraph('p2'),
          ],
          preservedXmlFragments: [NORMAL],
        },
      ],
    }
    // The recorded section is history, so the body stays one section:
    // anything else registers a phantom break at p1 and splits the pages.
    expect(layoutDocument(withHistory)).toHaveLength(1)
  })

  it('folds a pending section break into the painted model', () => {
    const base = model(['p1', 'p2'])
    const broken = withBreakDrafts(base, [
      { id: 'b1', paragraphId: 'p2', offset: 0, kind: 'section' },
    ])
    const painted = broken.stories[0]?.paragraphs.find(
      (item) => item.id === 'p2',
    )
    expect(painted?.preservedXmlFragments.join('')).toContain('<w:sectPr')
    expect(withBreakDrafts(base, [])).toBe(base)
    // A page break is laid out at its offset, not appended to the paragraph.
    expect(
      withBreakDrafts(base, [
        { id: 'b2', paragraphId: 'p1', offset: 0, kind: 'page' },
      ]),
    ).toBe(base)
  })

  it('paints one section fragment for two pending section breaks on one paragraph', () => {
    const base = model(['p1', 'p2'])
    const single = withBreakDrafts(base, [
      { id: 'b1', paragraphId: 'p2', offset: 0, kind: 'section' },
    ])
    const doubled = withBreakDrafts(base, [
      { id: 'b1', paragraphId: 'p2', offset: 0, kind: 'section' },
      { id: 'b2', paragraphId: 'p2', offset: 0, kind: 'section' },
    ])
    const painted = doubled.stories[0]?.paragraphs.find(
      (item) => item.id === 'p2',
    )
    // The writer refuses a second section break on the same paragraph, so the
    // preview must register exactly one section or later sections' geometry
    // index shifts.
    expect(
      painted?.preservedXmlFragments.join('').match(/<w:sectPr\b/gu),
    ).toHaveLength(1)
    expect(layoutDocument(doubled)).toHaveLength(layoutDocument(single).length)
  })

  it('merges a pending section break into an existing paragraph properties fragment', () => {
    // The writer inserts the section into the paragraph's live `w:pPr`, so the
    // painted model must merge there too instead of appending a second
    // properties fragment the save would never produce.
    const base = modelWithParagraphFragments({
      p1: ['<w:pPr><w:jc w:val="center"/></w:pPr>'],
    })
    const painted = withBreakDrafts(base, [
      { id: 'b1', paragraphId: 'p1', offset: 0, kind: 'section' },
    ])
    const fragments =
      painted.stories[0]?.paragraphs[0]?.preservedXmlFragments ?? []
    expect(fragments.join('').match(/<w:pPr\b/gu)).toHaveLength(1)
    const properties =
      fragments.find((fragment) => /<w:pPr\b/u.test(fragment)) ?? ''
    expect(properties).toContain('<w:jc w:val="center"/>')
    expect(properties).toContain('<w:sectPr')
    // `w:sectPr` is last in `CT_PPr`, after `w:jc`.
    expect(properties.indexOf('<w:sectPr')).toBeGreaterThan(
      properties.indexOf('<w:jc'),
    )
  })

  it('leaves a paragraph that already ends a section unpainted', () => {
    // The writer refuses a second section on this paragraph, so painting one
    // would register a phantom section the save never writes.
    const existing =
      '<w:pPr><w:sectPr><w:pgSz w:w="8000" w:h="6000"/><w:pgMar w:top="720"/></w:sectPr></w:pPr>'
    const base = modelWithParagraphFragments({ p1: [existing], p2: [] })
    const painted = withBreakDrafts(base, [
      { id: 'b1', paragraphId: 'p1', offset: 0, kind: 'section' },
    ])
    const paragraph = painted.stories[0]?.paragraphs.find(
      (item) => item.id === 'p1',
    )
    expect(paragraph?.preservedXmlFragments).toEqual([existing])
    expect(
      paragraph?.preservedXmlFragments.join('').match(/<w:sectPr\b/gu),
    ).toHaveLength(1)
    // The existing section and the body-level section: no phantom third.
    expect(documentSections(painted)).toHaveLength(2)
  })

  it('starts a new sheet at a pending page break offset', () => {
    const pages = layoutDocument(
      model(['p1', 'p2']),
      undefined,
      [],
      {},
      undefined,
      [{ id: 'b1', paragraphId: 'p1', offset: 2, kind: 'page' }],
    )
    expect(pages).toHaveLength(2)
    const first = pages[0]?.blocks[0]
    expect(first?.type).toBe('paragraph')
    if (first?.type !== 'paragraph') return
    expect(first.paragraph.id).toBe('p1')
    expect(first.from).toBe(0)
    expect(first.to).toBe(2)
    // The remainder of p1 and the following paragraph start the new sheet.
    const second = pages[1]?.blocks
    const secondParagraphs = (second ?? []).flatMap((block) =>
      block.type === 'paragraph' ? [block.paragraph.id] : [],
    )
    expect(secondParagraphs).toEqual(['p1', 'p2'])
  })

  it('opens a new sheet when the break sits at the end of a paragraph', () => {
    const pages = layoutDocument(model(['p1']), undefined, [], {}, undefined, [
      { id: 'b1', paragraphId: 'p1', offset: 4, kind: 'page' },
    ])
    expect(pages).toHaveLength(2)
    expect(pages[0]?.blocks).toHaveLength(1)
    expect(pages[1]?.blocks).toHaveLength(0)
  })

  it('paints two page breaks on one paragraph in text order, not insertion order', () => {
    // 'p1' is 'text': out-of-order drafts 3 then 1 must still split at 1 first.
    const pages = layoutDocument(model(['p1']), undefined, [], {}, undefined, [
      { id: 'b1', paragraphId: 'p1', offset: 3, kind: 'page' },
      { id: 'b2', paragraphId: 'p1', offset: 1, kind: 'page' },
    ])
    expect(pages).toHaveLength(3)
    expect(pages[0]?.blocks[0]).toMatchObject({ from: 0, to: 1 })
    expect(pages[1]?.blocks[0]).toMatchObject({ from: 1, to: 3 })
    expect(pages[2]?.blocks[0]).toMatchObject({ from: 3, to: 4 })
  })

  it('seeds a same-batch section break from the pending page setup', () => {
    const state = {
      ...emptyDraftState(),
      format: { ...emptyFormatDrafts, section: { margins: { top: 720 } } },
      breaks: [
        { id: 'b1', paragraphId: 'p1', offset: 0, kind: 'section' as const },
      ],
    }
    const model = modelWithSection(NORMAL)
    const plan = planDocumentSave(model, state)
    expect(plan.operations).toEqual([
      { type: 'set_section_properties', margins: { top: 720 } },
      { type: 'insert_section_break', paragraphId: 'p1' },
    ])
    // Paint seeds the same geometry: formattedModel applies the section draft
    // before the break is folded, so both paths read the new margins.
    const painted = withBreakDrafts(
      formattedModel(model, state.format),
      state.breaks,
    )
    const paragraph = painted.stories[0]?.paragraphs[0]
    expect(paragraph?.preservedXmlFragments.join('')).toContain(
      '<w:pgMar w:top="720"',
    )
  })
})

function model(paragraphIds: string[]): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: paragraphIds.map((id) => paragraph(id)),
        preservedXmlFragments: [],
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
    comments: [],
  }
}

function paragraph(id: string): DocumentParagraphWire {
  return {
    id,
    runs: [{ id: `${id}-r`, text: 'text', preservedXmlFragments: [] }],
    preservedXmlFragments: [],
  }
}

function modelWithParagraphFragments(
  fragments: Record<string, string[]>,
): DocumentModelWire {
  const ids = Object.keys(fragments)
  return {
    ...model(ids),
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: ids.map((id) => ({
          ...paragraph(id),
          preservedXmlFragments: fragments[id] ?? [],
        })),
        preservedXmlFragments: [NORMAL],
      },
    ],
  }
}

function modelWithSection(sect: string): DocumentModelWire {
  return {
    ...model(['p1']),
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: [paragraph('p1')],
        preservedXmlFragments: [sect],
      },
    ],
  }
}
