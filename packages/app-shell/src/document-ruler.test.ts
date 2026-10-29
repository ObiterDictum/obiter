import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  RULER_CM_PX,
  rulerLabel,
  rulerMarkers,
  rulerTicks,
  type RulerGeometry,
} from './document-ruler'
import { paragraphFace } from './document-page-style'

const GEOMETRY: RulerGeometry = {
  box: {
    widthPx: 794,
    heightPx: 1123,
    margin: { top: 96, right: 96, bottom: 96, left: 96 },
    headerPx: 48,
    footerPx: 48,
  },
  frame: {
    top: 96,
    right: 96,
    bottom: 96,
    left: 96,
    widthPx: 602,
    heightPx: 931,
  },
  column: { left: 0, widthPx: 602 },
}

describe('rulerMarkers', () => {
  it('places a plain paragraph at the column edges', () => {
    expect(rulerMarkers({ columnWidthPx: 602 })).toEqual({
      leftPx: 0,
      firstLinePx: 0,
      rightPx: 602,
    })
  })

  it('maps first-line and hanging indents onto the markers', () => {
    const markers = rulerMarkers({
      columnWidthPx: 602,
      face: {
        marginTopPx: 0,
        marginBottomPx: 0,
        run: {},
        indentLeftPx: 40,
        indentRightPx: 30,
        indentFirstPx: 20,
      },
    })
    expect(markers).toEqual({ leftPx: 40, firstLinePx: 60, rightPx: 572 })

    const hanging = rulerMarkers({
      columnWidthPx: 602,
      face: {
        marginTopPx: 0,
        marginBottomPx: 0,
        run: {},
        indentLeftPx: 40,
        indentHangingPx: 15,
      },
    })
    expect(hanging.firstLinePx).toBe(25)
  })

  it('draws a hanging indent the paragraph style supplies', () => {
    const model = {
      version: 1,
      stories: [
        {
          partName: 'word/document.xml',
          kind: 'document',
          paragraphs: [
            {
              id: 'p1',
              styleId: 'Hang',
              runs: [{ id: 'p1-r', text: 'text', preservedXmlFragments: [] }],
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
          fields: [],
          unanchoredFieldParagraphIds: [],
        },
      ],
      styles: [
        {
          styleId: 'Hang',
          sourceFragment:
            '<w:style w:type="paragraph" w:styleId="Hang"><w:name w:val="Hang"/><w:pPr><w:ind w:left="480" w:hanging="240"/></w:pPr></w:style>',
        },
      ],
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
    } as DocumentModelWire
    const face = paragraphFace(model.stories[0]!.paragraphs[0]!, model.styles)
    expect(face.indentHangingPx).toBe(16)
    expect(rulerMarkers({ columnWidthPx: 602, face }).firstLinePx).toBe(32 - 16)
  })

  it('hangs a list marker left of its text indent', () => {
    const markers = rulerMarkers({
      columnWidthPx: 602,
      list: { leftPx: 48, hangingPx: 18 },
    })
    expect(markers).toEqual({ leftPx: 48, firstLinePx: 30, rightPx: 602 })
  })
})

describe('rulerTicks', () => {
  it('marks half-centimetres and labels the whole ones', () => {
    const ticks = rulerTicks(RULER_CM_PX * 3)
    expect(ticks).toHaveLength(7)
    expect(ticks[0]).toEqual({ positionPx: 0, label: '0' })
    expect(ticks[1]?.label).toBeUndefined()
    expect(ticks[2]).toEqual({ positionPx: RULER_CM_PX, label: '1' })
    expect(ticks.at(-1)).toEqual({ positionPx: RULER_CM_PX * 3, label: '3' })
  })
})

describe('rulerLabel', () => {
  it('summarises real page and indent measurements', () => {
    const label = rulerLabel({
      geometry: GEOMETRY,
      markers: { leftPx: 40, firstLinePx: 60, rightPx: 572 },
    })
    expect(label).toContain(`Page width ${(794 / RULER_CM_PX).toFixed(1)} cm`)
    expect(label).toContain(`starts ${(96 / RULER_CM_PX).toFixed(1)} cm`)
    expect(label).toContain(`Left indent ${(40 / RULER_CM_PX).toFixed(1)} cm`)
    expect(label).toContain(`right indent ${(572 / RULER_CM_PX).toFixed(1)} cm`)
  })
})
