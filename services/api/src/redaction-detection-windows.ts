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

interface ClusterEntry {
  candidate: Candidate
  current: boolean
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

function unionCandidate(left: Candidate, right: Candidate): Candidate {
  const base = prefers(left, right) ? left : right
  return {
    span: {
      ...base.span,
      start: Math.min(left.span.start, right.span.start),
      end: Math.max(left.span.end, right.span.end),
      suggestion:
        left.span.suggestion === 'redact' || right.span.suggestion === 'redact'
          ? 'redact'
          : base.span.suggestion,
    },
    windowIndex: base.windowIndex,
    touchesEdge: left.touchesEdge || right.touchesEdge,
  }
}

export function mergeWindowDetections(
  detections: readonly WindowDetection[],
  text: string,
): RedactionSpan[] {
  const orderedWindows = detections
    .map((detection, index) => ({ detection, index }))
    .sort(
      (left, right) =>
        left.detection.window.start - right.detection.window.start ||
        left.index - right.index,
    )
  const unique = new Map<string, Candidate>()
  orderedWindows.forEach(({ detection }, windowIndex) => {
    const { window, spans } = detection
    const windowLength = window.end - window.start
    for (const span of spans) {
      if (span.start >= span.end) continue
      const candidate: Candidate = {
        span: {
          ...span,
          id: `${span.id}@${window.start}`,
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

  const byCategory = new Map<
    RedactionSpan['category'],
    Map<number, Candidate[]>
  >()
  for (const candidate of unique.values()) {
    let windows = byCategory.get(candidate.span.category)
    if (windows === undefined) {
      windows = new Map()
      byCategory.set(candidate.span.category, windows)
    }
    const existing = windows.get(candidate.windowIndex)
    if (existing === undefined) windows.set(candidate.windowIndex, [candidate])
    else existing.push(candidate)
  }

  const merged: Candidate[] = []
  for (const windows of byCategory.values()) {
    let pending: Candidate[] = []
    const finished: Candidate[] = []
    for (const [windowIndex, { detection }] of orderedWindows.entries()) {
      pending = pending.filter((candidate) => {
        if (candidate.span.end > detection.window.start) return true
        finished.push(candidate)
        return false
      })
      const current = windows.get(windowIndex)
      if (current === undefined) continue
      const entries: ClusterEntry[] = [
        ...pending.map((candidate) => ({ candidate, current: false })),
        ...current.map((candidate) => ({ candidate, current: true })),
      ].sort(
        (left, right) =>
          left.candidate.span.start - right.candidate.span.start ||
          left.candidate.span.end - right.candidate.span.end,
      )
      const nextPending: Candidate[] = []
      let cluster: ClusterEntry[] = []
      let clusterEnd = -1
      const flushCluster = () => {
        if (cluster.length === 0) return
        const hasCurrent = cluster.some((entry) => entry.current)
        const hasPending = cluster.some((entry) => !entry.current)
        if (hasCurrent && hasPending)
          nextPending.push(
            cluster.map((entry) => entry.candidate).reduce(unionCandidate),
          )
        else for (const entry of cluster) nextPending.push(entry.candidate)
        cluster = []
        clusterEnd = -1
      }
      for (const entry of entries) {
        if (entry.candidate.span.start >= clusterEnd) flushCluster()
        cluster.push(entry)
        if (entry.candidate.span.end > clusterEnd)
          clusterEnd = entry.candidate.span.end
      }
      flushCluster()
      pending = nextPending
    }
    merged.push(...finished, ...pending)
  }

  return merged
    .sort(
      (left, right) =>
        left.span.start - right.span.start || left.span.end - right.span.end,
    )
    .map((candidate) => ({
      ...candidate.span,
      text: text.slice(candidate.span.start, candidate.span.end),
    }))
}
