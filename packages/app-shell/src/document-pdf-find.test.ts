import { describe, expect, it } from 'bun:test'
import type {
  DocumentPdfViewResponse,
  DocumentTextLayoutSegment,
} from '@obiter/contracts'
import { pdfFindHits, pdfSliceBounds } from './document-find'

const segment = (
  start: number,
  end: number,
  pageIndex: number,
  extras: Partial<DocumentTextLayoutSegment> = {},
): DocumentTextLayoutSegment => ({
  start,
  end,
  pageIndex,
  x: 0,
  y: pageIndex * 100,
  width: (end - start) * 10,
  height: 12,
  ...extras,
})

const view = (
  text: string,
  segments: DocumentTextLayoutSegment[],
  pageCount = 3,
): DocumentPdfViewResponse => ({
  documentId: 'doc1',
  versionId: 'v1',
  versionNumber: 1,
  text,
  layout: {
    version: 1,
    pages: Array.from({ length: pageCount }, () => ({
      width: 600,
      height: 800,
    })),
    segments,
  },
})

describe('pdfFindHits', () => {
  it('maps a hit inside one segment to a slice of that segment', () => {
    // 'alpha beta': 'beta' sits at 6..10, inside segment 0 covering 0..11.
    const hits = pdfFindHits(view('alpha beta', [segment(0, 11, 0)]), 'beta', {
      matchCase: false,
      wholeWord: false,
    })
    expect(hits).toEqual([
      {
        start: 6,
        end: 10,
        pageIndex: 0,
        slices: [{ segment: 0, start: 6, end: 10 }],
      },
    ])
  })

  it('slices a hit that spans a segment and a page boundary', () => {
    // 'wrap across' split across two pages: segment 0 'wrap ' (0..5, page 0),
    // segment 1 'across' (5..11, page 1). 'p a' covers 3..6 of the text.
    const hits = pdfFindHits(
      view('wrap across', [segment(0, 5, 0), segment(5, 11, 1)]),
      'p a',
      { matchCase: false, wholeWord: false },
    )
    expect(hits).toEqual([
      {
        start: 3,
        end: 6,
        pageIndex: 0,
        slices: [
          { segment: 0, start: 3, end: 5 },
          { segment: 1, start: 0, end: 1 },
        ],
      },
    ])
  })

  it('honours match-case and whole-word over the extracted text', () => {
    const source = view('Case case', [segment(0, 9, 0)])
    expect(
      pdfFindHits(source, 'case', { matchCase: true, wholeWord: false }).map(
        (hit) => hit.start,
      ),
    ).toEqual([5])
    expect(
      pdfFindHits(source, 'cas', { matchCase: false, wholeWord: true }),
    ).toEqual([])
  })

  it('reports no slices when segments do not cover the hit', () => {
    const hits = pdfFindHits(view('orphan hit', [segment(0, 6, 0)]), 'hit', {
      matchCase: false,
      wholeWord: false,
    })
    // The text still matches — the extractor's layout may not cover it. The
    // hit is honest: found, navigable, with nothing to paint.
    expect(hits).toEqual([{ start: 7, end: 10, pageIndex: 0, slices: [] }])
  })

  it('returns no hits for an empty query', () => {
    expect(
      pdfFindHits(view('anything', [segment(0, 8, 0)]), '', {
        matchCase: false,
        wholeWord: false,
      }),
    ).toEqual([])
  })
})

describe('pdfSliceBounds', () => {
  it('interpolates proportional bounds for version-1 segments', () => {
    const bounds = pdfSliceBounds(
      { width: 100, start: 0, end: 10 },
      { start: 2, end: 5 },
    )
    expect(bounds).toEqual({ left: 20, width: 30 })
  })

  it('keeps bounds proportional even when advances exist, matching the span', () => {
    // The viewer mounts each segment's text as one span at the segment box,
    // so a highlight tracks the same proportional interpolation the text
    // itself is placed with — per-character advances would sit the slice
    // where the text is not.
    const bounds = pdfSliceBounds(
      { width: 100, start: 0, end: 4 },
      { start: 1, end: 3 },
    )
    expect(bounds).toEqual({ left: 25, width: 50 })
  })
})
