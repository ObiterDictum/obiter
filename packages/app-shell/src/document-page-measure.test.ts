import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import type { BreakDraft } from './document-edits'
import { documentStory } from './document-model-text'
import { layoutDocument, type DocumentLayoutFlow } from './document-page-engine'
import { clearParagraphMeasureCache } from './document-page-measure'
import { storyBlocks } from './document-page-tables'
import {
  applyDeleteBackward,
  applyInsertText,
  applySplitParagraph,
  blockText,
  emptyEditorState,
  joinIntoPrevious,
  type EditorState,
} from './document-word-edits'

const SHORT_PAGE =
  '<w:sectPr><w:pgSz w:w="11906" w:h="4200"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>'
const WIDE_SECTION =
  '<w:sectPr><w:pgSz w:w="11906" w:h="4200"/><w:pgMar w:top="1440" w:right="720" w:bottom="720" w:left="720"/><w:cols w:num="2" w:space="720"/></w:sectPr>'
const WEB_FLOW: DocumentLayoutFlow = { kind: 'web', widthPx: 640 }

const SENTENCES = [
  'The Claimant seeks damages for breach of clause 4.2 of the agreement.',
  'It is common ground that the parties entered a written contract.',
  'The Defendant denies liability and says the notice was out of time.',
  'In my judgment the natural meaning is the one the Claimant advances.',
  'Supercalifragilisticexpialidociouswordwithoutanybreakopportunity',
  '',
]

function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function paragraphText(index: number, next: () => number): string {
  const count = 1 + Math.floor(next() * 4)
  const parts: string[] = []
  for (let step = 0; step < count; step += 1) {
    parts.push(SENTENCES[(index + step) % SENTENCES.length] ?? '')
  }
  return parts.join(' ').trim()
}

function paragraph(
  id: string,
  text: string,
  xml: string[],
  runXml: string[] = [],
): DocumentParagraphWire {
  return {
    id,
    runs: [{ id: `${id}-r`, text, preservedXmlFragments: runXml }],
    preservedXmlFragments: xml,
  }
}

function buildModel(count: number, seed: number): DocumentModelWire {
  const next = random(seed)
  const sectionBreakAt = Math.floor(count / 2)
  const paragraphs = Array.from({ length: count }, (_, index) => {
    const id = `p${index + 1}`
    const xml: string[] = []
    if (index % 7 === 3) xml.push('<w:pPr><w:keepNext/></w:pPr>')
    if (index % 11 === 5) xml.push('<w:pPr><w:widowControl w:val="0"/></w:pPr>')
    if (index === 2)
      xml.push('<w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>')
    if (index === sectionBreakAt) xml.push(WIDE_SECTION)
    const styled = index % 5 === 0 ? { styleId: 'Body' } : {}
    const runXml = index % 13 === 7 ? ['<w:br w:type="page"/>'] : []
    return {
      ...paragraph(id, paragraphText(index, next), xml, runXml),
      ...styled,
    }
  })
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs,
        preservedXmlFragments: [SHORT_PAGE],
        fields: [],
        unanchoredFieldParagraphIds: [],
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
    comments: [],
    trackRevisions: false,
    markings: {
      documentKind: null,
      draft: false,
      privileged: false,
      withoutPrejudice: false,
    },
  }
}

type Fixture = {
  model: DocumentModelWire
  state: EditorState
  breaks: BreakDraft[]
}

function flowIds(fixture: Fixture): string[] {
  const story = documentStory(fixture.model)
  return [
    ...(story?.paragraphs ?? []).map((item) => item.id),
    ...fixture.state.inserts.map((item) => item.clientId),
  ]
}

function pick<T>(items: T[], next: () => number): T | undefined {
  if (items.length === 0) return undefined
  return items[Math.floor(next() * items.length)]
}

function editText(fixture: Fixture, next: () => number): Fixture {
  const ids = flowIds(fixture)
  const bias = next()
  const story = documentStory(fixture.model)
  const keepNext = (story?.paragraphs ?? []).filter((item) =>
    item.preservedXmlFragments.some((xml) => xml.includes('keepNext')),
  )
  const nearSection = (story?.paragraphs ?? []).slice(
    Math.floor((story?.paragraphs.length ?? 1) / 2) - 1,
    Math.floor((story?.paragraphs.length ?? 1) / 2) + 2,
  )
  const chosen =
    bias < 0.2
      ? pick(
          keepNext.map((item) => item.id),
          next,
        )
      : bias < 0.4
        ? pick(
            nearSection.map((item) => item.id),
            next,
          )
        : pick(ids, next)
  if (!chosen) return fixture
  const text = blockText(fixture.model, fixture.state, chosen)
  const offset = Math.floor(next() * (text.length + 1))
  const roll = next()
  if (roll < 0.4) {
    const insert = ['a', 'word ', '\n', ' The Claimant submits that '][
      Math.floor(next() * 4)
    ]
    const result = applyInsertText(
      fixture.model,
      fixture.state,
      { paragraphId: chosen, offset },
      insert ?? 'a',
    )
    return result ? { ...fixture, state: result.state } : fixture
  }
  if (roll < 0.7 && offset > 0) {
    const result = applyDeleteBackward(fixture.model, fixture.state, {
      paragraphId: chosen,
      offset,
    })
    return result ? { ...fixture, state: result.state } : fixture
  }
  if (roll < 0.9 && offset > 0 && offset < text.length) {
    const result = applySplitParagraph(
      fixture.model,
      fixture.state,
      { paragraphId: chosen, offset },
      `ins-${fixture.state.inserts.length + 1}`,
    )
    return result ? { ...fixture, state: result.state } : fixture
  }
  const target = pick(ids.slice(1), next)
  if (!target) return fixture
  const joined = joinIntoPrevious(fixture.model, fixture.state, target)
  return joined ? { ...fixture, state: joined.state } : fixture
}

function editBreaks(fixture: Fixture, next: () => number): Fixture {
  const ids = flowIds(fixture)
  const id = pick(ids, next)
  if (!id) return fixture
  const existing = fixture.breaks.findIndex(
    (item) => item.paragraphId === id && item.kind === 'page',
  )
  if (existing >= 0) {
    return {
      ...fixture,
      breaks: fixture.breaks.filter((_, index) => index !== existing),
    }
  }
  const text = blockText(fixture.model, fixture.state, id)
  return {
    ...fixture,
    breaks: [
      ...fixture.breaks,
      {
        id: `break-${String(fixture.breaks.length + 1)}`,
        kind: 'page',
        paragraphId: id,
        offset: Math.floor(next() * (text.length + 1)),
      },
    ],
  }
}

function edit(fixture: Fixture, next: () => number): Fixture {
  return next() < 0.15 ? editBreaks(fixture, next) : editText(fixture, next)
}

function layOut(fixture: Fixture, flow?: DocumentLayoutFlow) {
  const story = documentStory(fixture.model)
  return layoutDocument(
    fixture.model,
    fixture.state.drafts,
    fixture.state.inserts,
    fixture.state.extraRuns,
    story ? storyBlocks(story) : [],
    fixture.breaks,
    flow,
  )
}

describe('incremental page layout', () => {
  for (const count of [9, 45, 140]) {
    for (const seed of [11, 29, 47]) {
      it(`reuses cached paragraph measurement without changing a ${String(count)}-paragraph document (seed ${String(seed)})`, () => {
        const next = random(seed * 97 + count)
        let fixture: Fixture = {
          model: buildModel(count, seed),
          state: emptyEditorState(),
          breaks: [],
        }
        let sawPagination = false
        for (let step = 0; step < 40; step += 1) {
          fixture = edit(fixture, next)
          const warm = layOut(fixture)
          clearParagraphMeasureCache()
          const cold = layOut(fixture)
          expect(warm).toEqual(cold)
          if (warm.length > 1) sawPagination = true
        }
        expect(sawPagination).toBe(true)
      })
    }
  }

  it('matches a cold layout on every edit in the web flow', () => {
    const next = random(1013)
    let fixture: Fixture = {
      model: buildModel(60, 1013),
      state: emptyEditorState(),
      breaks: [],
    }
    for (let step = 0; step < 25; step += 1) {
      fixture = edit(fixture, next)
      const warm = layOut(fixture, WEB_FLOW)
      clearParagraphMeasureCache()
      expect(warm).toEqual(layOut(fixture, WEB_FLOW))
    }
  })

  it('matches a cold layout after a page break and a section change together', () => {
    const next = random(7717)
    let fixture: Fixture = {
      model: buildModel(80, 7717),
      state: emptyEditorState(),
      breaks: [{ id: 'break-1', kind: 'page', paragraphId: 'p3', offset: 0 }],
    }
    layOut(fixture)
    const split = applySplitParagraph(
      fixture.model,
      fixture.state,
      { paragraphId: 'p40', offset: 10 },
      'ins-1',
    )
    if (!split) throw new Error('expected a split')
    fixture = { ...fixture, state: split.state }
    for (let step = 0; step < 20; step += 1) {
      fixture = edit(fixture, next)
      const warm = layOut(fixture)
      clearParagraphMeasureCache()
      expect(warm).toEqual(layOut(fixture))
    }
  })

  it('drops cached measurement when styles or tracked changes move', () => {
    const fixture: Fixture = {
      model: buildModel(50, 505),
      state: emptyEditorState(),
      breaks: [],
    }
    const styled = {
      ...fixture.model,
      styles: [
        {
          styleId: 'Body',
          sourceFragment:
            '<w:style w:type="paragraph" w:styleId="Body"><w:pPr><w:spacing w:before="480"/></w:pPr><w:rPr><w:sz w:val="40"/></w:rPr></w:style>',
        },
      ],
      changes: [
        {
          id: 'c1',
          kind: 'insert',
          elementName: 'ins',
          paragraphId: 'p2',
          storyPartName: 'word/document.xml',
          text: 'revision ',
          inlinePosition: { beforeRunId: null },
        },
      ],
    } as DocumentModelWire
    layOut(fixture)
    const warm = layOut({ ...fixture, model: styled })
    clearParagraphMeasureCache()
    expect(warm).toEqual(layOut({ ...fixture, model: styled }))
  })
})
