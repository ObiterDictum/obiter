import { describe, expect, it } from 'bun:test'
import type {
  RedactionSpan,
  SpanCategory,
  SpanConfidence,
} from '@obiter/redaction-policy'
import {
  DETECTION_WINDOW_CHARS,
  DETECTION_WINDOW_OVERLAP_CHARS,
  mergeWindowDetections,
  planDetectionWindows,
} from './redaction-detection-windows'

function span(
  start: number,
  end: number,
  category: SpanCategory = 'person_name',
  confidence: SpanConfidence = 'high',
): RedactionSpan {
  return {
    id: `span_${start}_${end}_${category}`,
    start,
    end,
    text: '',
    category,
    source: 'rampart_model',
    confidence,
    suggestion: 'redact',
  }
}

describe('detection windows', () => {
  it('plans one window for a document exactly at the detection limit', () => {
    const text = 'x'.repeat(DETECTION_WINDOW_CHARS)

    expect(planDetectionWindows(text)).toEqual([
      { start: 0, end: DETECTION_WINDOW_CHARS },
    ])
  })

  it('covers a long document with windows no longer than the detection limit', () => {
    const text = 'x'.repeat(500_000)
    const windows = planDetectionWindows(text)

    expect(windows.length).toBeGreaterThan(1)
    expect(windows[0]).toEqual({ start: 0, end: DETECTION_WINDOW_CHARS })
    expect(windows[windows.length - 1].end).toBe(text.length)
    for (const [index, window] of windows.entries()) {
      expect(window.end - window.start).toBeLessThanOrEqual(
        DETECTION_WINDOW_CHARS,
      )
      expect(window.end).toBeGreaterThan(window.start)
      if (index > 0) expect(window.start).toBeLessThan(windows[index - 1].end)
    }
  })

  it('overlaps adjacent windows by at least the configured overlap', () => {
    const windows = planDetectionWindows('x'.repeat(900_000))

    for (let index = 1; index < windows.length; index++) {
      expect(windows[index].start).toBeLessThanOrEqual(
        windows[index - 1].end - DETECTION_WINDOW_OVERLAP_CHARS,
      )
    }
  })

  it('cuts at a paragraph break when one falls inside the snap distance', () => {
    const text = `${'a'.repeat(350)}\n\n${'b'.repeat(200)}`

    expect(planDetectionWindows(text, 400)[0]).toEqual({ start: 0, end: 351 })
  })

  it('cuts after whitespace when no paragraph break is near', () => {
    const text = `${'a'.repeat(350)} ${'b'.repeat(200)}`

    expect(planDetectionWindows(text, 400)[0]).toEqual({ start: 0, end: 351 })
  })

  it('makes progress through a window that contains no whitespace', () => {
    const windows = planDetectionWindows('x'.repeat(1_000), 400, 40)

    expect(windows).toEqual([
      { start: 0, end: 400 },
      { start: 360, end: 760 },
      { start: 720, end: 1_000 },
    ])
  })
})

describe('merging window detections', () => {
  it('maps window-local spans back to document offsets', () => {
    const text = 'a'.repeat(300)

    const spans = mergeWindowDetections(
      [
        { window: { start: 0, end: 200 }, spans: [span(10, 20)] },
        { window: { start: 196, end: 300 }, spans: [span(4, 14)] },
      ],
      text,
    )

    expect(spans.map(({ start, end }) => [start, end])).toEqual([
      [10, 20],
      [200, 210],
    ])
    expect(spans[1].text).toBe(text.slice(200, 210))
  })

  it('keeps one span when overlapping windows find the same range and category', () => {
    const spans = mergeWindowDetections(
      [
        { window: { start: 0, end: 200 }, spans: [span(196, 199)] },
        { window: { start: 196, end: 300 }, spans: [span(0, 3)] },
      ],
      'a'.repeat(300),
    )

    expect(spans.map(({ start, end }) => [start, end])).toEqual([[196, 199]])
  })

  it('prefers a complete span over the truncated copy that touches a window edge', () => {
    const spans = mergeWindowDetections(
      [
        { window: { start: 0, end: 200 }, spans: [span(195, 200)] },
        { window: { start: 190, end: 300 }, spans: [span(5, 15)] },
      ],
      'a'.repeat(300),
    )

    expect(spans.map(({ start, end }) => [start, end])).toEqual([[195, 205]])
  })

  it('covers the union when two windows report crossing ranges that both touch an edge', () => {
    const text = 'a'.repeat(300)
    const spans = mergeWindowDetections(
      [
        { window: { start: 0, end: 200 }, spans: [span(190, 200)] },
        { window: { start: 196, end: 300 }, spans: [span(0, 9)] },
      ],
      text,
    )

    expect(spans.map(({ start, end }) => [start, end])).toEqual([[190, 205]])
    expect(spans[0].text).toBe(text.slice(190, 205))
  })

  it('covers the union when crossing ranges chain through a third window', () => {
    const spans = mergeWindowDetections(
      [
        { window: { start: 0, end: 100 }, spans: [span(90, 100)] },
        { window: { start: 95, end: 150 }, spans: [span(0, 20)] },
        { window: { start: 110, end: 200 }, spans: [span(0, 30)] },
      ],
      'a'.repeat(200),
    )

    expect(spans.map(({ start, end }) => [start, end])).toEqual([[90, 140]])
  })

  it('keeps the containing span when a detected range sits inside another window range', () => {
    const spans = mergeWindowDetections(
      [
        { window: { start: 0, end: 200 }, spans: [span(190, 200)] },
        { window: { start: 180, end: 300 }, spans: [span(10, 30)] },
      ],
      'a'.repeat(300),
    )

    expect(spans.map(({ start, end }) => [start, end])).toEqual([[190, 210]])
  })

  it('gives spans from different windows distinct ids', () => {
    const spans = mergeWindowDetections(
      [
        { window: { start: 0, end: 200 }, spans: [span(10, 20)] },
        { window: { start: 196, end: 300 }, spans: [span(10, 20)] },
      ],
      'a'.repeat(300),
    )

    expect(spans.map(({ id }) => id)).toEqual([
      'span_10_20_person_name@0',
      'span_10_20_person_name@196',
    ])
  })

  it('keeps both categories when two windows find the same range under different categories', () => {
    const spans = mergeWindowDetections(
      [
        { window: { start: 0, end: 200 }, spans: [span(196, 199)] },
        {
          window: { start: 196, end: 300 },
          spans: [span(0, 3, 'address')],
        },
      ],
      'a'.repeat(300),
    )

    expect(spans.map(({ category }) => category).sort()).toEqual([
      'address',
      'person_name',
    ])
  })

  it('leaves overlapping spans found inside one window untouched', () => {
    const spans = mergeWindowDetections(
      [
        {
          window: { start: 0, end: 200 },
          spans: [span(10, 20), span(15, 25)],
        },
      ],
      'a'.repeat(200),
    )

    expect(spans.map(({ start, end }) => [start, end])).toEqual([
      [10, 20],
      [15, 25],
    ])
  })
})
