import type { RedactionSpan } from '@obiter/redaction-policy'

export interface DetectionWindow {
  start: number
  end: number
}

export interface WindowDetection {
  window: DetectionWindow
  spans: RedactionSpan[]
}

export const DETECTION_WINDOW_CHARS = 200_000
export const DETECTION_WINDOW_OVERLAP_CHARS = 4_000
const WINDOW_SNAP_CHARS = 512

const CONFIDENCE_RANK = {
  high: 3,
  medium: 2,
  low: 1,
} satisfies Record<RedactionSpan['confidence'], number>

export function planDetectionWindows(
  text: string,
  windowChars: number = DETECTION_WINDOW_CHARS,
  overlapChars: number = DETECTION_WINDOW_OVERLAP_CHARS,
): DetectionWindow[] {
  if (text.length <= windowChars) return [{ start: 0, end: text.length }]

  const overlap = Math.min(overlapChars, Math.floor(windowChars / 4))
  const snap = Math.min(WINDOW_SNAP_CHARS, Math.floor(windowChars / 4))
  const windows: DetectionWindow[] = []
  let start = 0
  while (start < text.length) {
    const limit = Math.min(start + windowChars, text.length)
    const end =
      limit === text.length ? limit : snapWindowEnd(text, start, limit, snap)
    windows.push({ start, end })
    if (end === text.length) break
    const next = Math.max(start + 1, end - overlap)
    start = snapWindowStart(text, next, end, snap)
  }
  return windows
}

function snapWindowEnd(
  text: string,
  start: number,
  limit: number,
  snap: number,
): number {
  const floor = Math.max(start + 1, limit - snap)
  for (let index = limit; index >= floor; index--) {
    if (text[index - 1] === '\n' && text[index] === '\n') return index
  }
  for (let index = limit - 1; index >= floor; index--) {
    if (/\s/.test(text[index])) return index + 1
  }
  return limit
}

function snapWindowStart(
  text: string,
  next: number,
  end: number,
  snap: number,
): number {
  const ceiling = Math.min(end - 1, next + snap)
  for (let index = next; index <= ceiling; index++) {
    if (!/\s/.test(text[index])) continue
    return index + 1 < end ? index + 1 : next
  }
  return next
}

interface Candidate {
  span: RedactionSpan
  windowIndex: number
  touchesEdge: boolean
}

function prefers(candidate: Candidate, incumbent: Candidate): boolean {
  if (candidate.touchesEdge !== incumbent.touchesEdge)
    return !candidate.touchesEdge
  const candidateLength = candidate.span.end - candidate.span.start
  const incumbentLength = incumbent.span.end - incumbent.span.start
  if (candidateLength !== incumbentLength)
    return candidateLength > incumbentLength
  const candidateRank = CONFIDENCE_RANK[candidate.span.confidence]
  const incumbentRank = CONFIDENCE_RANK[incumbent.span.confidence]
  if (candidateRank !== incumbentRank) return candidateRank > incumbentRank
  return (
    candidate.span.start < incumbent.span.start ||
    (candidate.span.start === incumbent.span.start &&
      candidate.windowIndex < incumbent.windowIndex)
  )
}

export function mergeWindowDetections(
  detections: readonly WindowDetection[],
  text: string,
): RedactionSpan[] {
  const unique = new Map<string, Candidate>()
  detections.forEach(({ window, spans }, windowIndex) => {
    const windowLength = window.end - window.start
    for (const span of spans) {
      if (span.start >= span.end) continue
      const candidate: Candidate = {
        span: {
          ...span,
          start: span.start + window.start,
          end: span.end + window.start,
        },
        windowIndex,
        touchesEdge: span.start === 0 || span.end === windowLength,
      }
      const key = `${candidate.span.start}:${candidate.span.end}:${candidate.span.category}`
      const existing = unique.get(key)
      if (existing === undefined || prefers(candidate, existing))
        unique.set(key, candidate)
    }
  })

  const ordered = [...unique.values()].sort(
    (left, right) =>
      left.span.start - right.span.start || left.span.end - right.span.end,
  )
  const dropped = new Set<Candidate>()
  const active: Candidate[] = []
  for (const candidate of ordered) {
    for (let index = active.length - 1; index >= 0; index--) {
      if (active[index].span.end <= candidate.span.start)
        active.splice(index, 1)
    }
    for (const other of active) {
      if (dropped.has(candidate) || dropped.has(other)) continue
      if (other.windowIndex === candidate.windowIndex) continue
      if (other.span.category !== candidate.span.category) continue
      if (prefers(candidate, other)) dropped.add(other)
      else dropped.add(candidate)
    }
    if (!dropped.has(candidate)) active.push(candidate)
  }

  return ordered
    .filter((candidate) => !dropped.has(candidate))
    .map((candidate) => ({
      ...candidate.span,
      text: text.slice(candidate.span.start, candidate.span.end),
    }))
}
