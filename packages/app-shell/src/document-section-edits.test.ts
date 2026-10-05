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
import { layoutDocument } from './document-page-engine'
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
    }
    const pages = layoutDocument(model)
    expect(pages).toHaveLength(2)
    expect(pages[0]?.box.widthPx).toBe(533)
    expect(pages[0]?.blocks).toHaveLength(1)
    expect(pages[1]?.box.widthPx).toBe(794)
    expect(pages[1]?.blocks).toHaveLength(2)
  })

  it('folds a pending page break into the painted model', () => {
    const base = model(['p1', 'p2'])
    const broken = withBreakDrafts(base, [
      { id: 'b1', paragraphId: 'p2', offset: 0, kind: 'page' },
    ])
    const painted = broken.stories[0]?.paragraphs.find(
      (item) => item.id === 'p2',
    )
    expect(painted?.preservedXmlFragments.join('')).toContain(
      '<w:br w:type="page"/>',
    )
    expect(withBreakDrafts(base, [])).toBe(base)
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
  }
}

function paragraph(id: string): DocumentParagraphWire {
  return {
    id,
    runs: [{ id: `${id}-r`, text: 'text', preservedXmlFragments: [] }],
    preservedXmlFragments: [],
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
