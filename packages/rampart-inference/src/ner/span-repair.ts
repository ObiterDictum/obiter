import type { PiiLabel, Span } from '../types'

export const EXTEND_SCORE = 0.15
const CONNECTOR_RE = /^[ \t'\u2019.-]*$/
const PERSON_LABELS: ReadonlySet<PiiLabel> = new Set(['GIVEN_NAME', 'SURNAME'])
const LEFT_PARTICLE_RE =
  /(?<![\p{L}\p{M}\u2019'])([\p{Lu}][\p{L}\p{M}\u2019']{0,3})([ \t'\u2019.-]{1,3})$/u
const RIGHT_PARTICLE_RE =
  /^([ \t'\u2019.-]{1,3})([\p{Lu}][\p{L}\p{M}\u2019']{0,3})(?![\p{L}\p{M}\u2019'])/u
const NON_NAME_PARTICLES = new Set([
  'law',
  'ltd',
  'plc',
  'llp',
  'llc',
  'inc',
  'court',
  'and',
  'the',
  'for',
  'of',
  'to',
  'in',
  'on',
  'at',
  'by',
])

export function repairSpans(
  raw: string,
  spans: readonly Span[],
  anchorScore: number,
): Span[] {
  let kept = spans.filter((span) => span.score >= anchorScore).map(copySpan)
  const candidates = spans
    .filter((span) => span.score >= EXTEND_SCORE && span.score < anchorScore)
    .map(copySpan)

  const MAX_ITERS = 32
  let iters = 0
  let changed = true
  while (changed && iters < MAX_ITERS) {
    changed = false
    iters++

    for (let i = candidates.length - 1; i >= 0; i--) {
      const candidate = candidates[i]
      if (kept.some((span) => canBridge(raw, candidate, span))) {
        kept.push(candidate)
        candidates.splice(i, 1)
        changed = true
      }
    }

    const merged = mergeAdjacentConnectors(raw, kept)
    const didMerge =
      merged.length !== kept.length ||
      merged.some(
        (span, index) =>
          span.start !== kept[index]?.start || span.end !== kept[index]?.end,
      )
    if (didMerge) {
      changed = true
    }
    kept = merged

    for (let i = 0; i < kept.length; i++) {
      const repaired = rescueCapitalizedParticles(raw, kept[i], kept, i)
      if (repaired.start !== kept[i].start || repaired.end !== kept[i].end) {
        kept[i] = repaired
        changed = true
      }
    }
  }

  return kept
    .map((span) => ({ ...span, text: raw.slice(span.start, span.end) }))
    .sort((a, b) => a.start - b.start || a.end - b.end)
}

function copySpan(span: Span): Span {
  return { ...span }
}

function isInitialChar(raw: string, idx: number): boolean {
  const c = raw[idx]
  if (c === undefined || !/\p{Lu}/u.test(c)) return false
  const prev = raw[idx - 1]
  return prev === undefined || !/\p{L}/u.test(prev)
}

function canBridge(raw: string, a: Span, b: Span): boolean {
  if (a.label !== b.label) return false
  const [left, right] = a.start <= b.start ? [a, b] : [b, a]
  const gap = raw.slice(left.end, right.start)
  if (!CONNECTOR_RE.test(gap)) return false
  if (gap.includes('.') && !isInitialChar(raw, left.end - 1)) return false
  return true
}

function mergeAdjacentConnectors(raw: string, spans: readonly Span[]): Span[] {
  const merged: Span[] = []
  for (const span of [...spans].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  )) {
    const previous = merged[merged.length - 1]
    if (previous !== undefined && canBridge(raw, previous, span)) {
      merged[merged.length - 1] = {
        ...previous,
        end: Math.max(previous.end, span.end),
        score: Math.max(previous.score, span.score),
        text: raw.slice(previous.start, Math.max(previous.end, span.end)),
      }
    } else {
      merged.push(copySpan(span))
    }
  }
  return merged
}

function rescueCapitalizedParticles(
  raw: string,
  span: Span,
  all: readonly Span[] = [],
  selfIndex = -1,
): Span {
  if (!PERSON_LABELS.has(span.label)) return span

  let leftBound = 0
  let rightBound = raw.length
  for (let i = 0; i < all.length; i++) {
    if (i === selfIndex) continue
    const other = all[i]
    if (other.end <= span.start && other.end > leftBound) leftBound = other.end
    if (other.start >= span.end && other.start < rightBound)
      rightBound = other.start
  }

  let start = span.start
  let end = span.end
  const left = LEFT_PARTICLE_RE.exec(raw.slice(0, start))
  if (
    left !== null &&
    CONNECTOR_RE.test(left[2]) &&
    !NON_NAME_PARTICLES.has(left[1].toLowerCase()) &&
    (!left[2].includes('.') || left[1].length === 1) &&
    start - left[0].length >= leftBound
  ) {
    start -= left[0].length
  }

  const right = RIGHT_PARTICLE_RE.exec(raw.slice(end))
  if (
    span.label === 'SURNAME' &&
    right !== null &&
    !right[1].includes('.') &&
    !NON_NAME_PARTICLES.has(right[2].toLowerCase()) &&
    end + right[0].length <= rightBound
  ) {
    end += right[0].length
  }

  return start === span.start && end === span.end
    ? span
    : { ...span, start, end, text: raw.slice(start, end) }
}

const NAME_WORD = String.raw`\p{Lu}(?=[\p{L}\p{M}]*\p{Ll})[\p{L}\p{M}]+(?:['’\-]\p{Lu}?[\p{Ll}\p{M}]+)*|\p{Lu}['’]\p{Lu}[\p{Ll}\p{M}]+`
const SURNAME = String.raw`(?:(?:[Vv]an|[Vv]on|[Dd]e|[Dd]el|[Dd]er|[Dd]en|[Dd]a|[Dd]i|[Dd]u|[Ll]a|[Ll]e|[Tt]er)[ \t]+){0,3}(?:${NAME_WORD})`
const NAME_CONTINUATION = /[\p{L}\p{M}'’\-]/u
const SINGLE_NAME_WORD = new RegExp(
  String.raw`^(?:${NAME_WORD})(?![\p{L}\p{M}'’\-])`,
  'u',
)
const FOLLOWING_SURNAME = new RegExp(
  String.raw`^[ \t]+(${SURNAME})(?![\p{L}\p{N}\p{M}'’\-]|[ \t]+\p{Lu})`,
  'u',
)
const NAME_LINE = new RegExp(
  String.raw`^[ \t]*(?:\p{Lu}[\p{Ll}]+:[ \t]+)?((?:${NAME_WORD})[ \t]+(${SURNAME}))[ \t]*$`,
  'gmu',
)
const NON_SURNAMES = new Set([
  ...NON_NAME_PARTICLES,
  'dear',
  'judge',
  'justice',
  'lord',
  'lady',
  'dame',
  'miss',
  'madam',
  'chambers',
  'solicitors',
  'limited',
  'street',
  'road',
  'avenue',
  'claimant',
  'defendant',
  'schedule',
  'exhibit',
  'appendix',
])

function overlaps(span: Span, start: number, end: number) {
  return span.start < end && start < span.end
}

export function completePersonSpans(raw: string, detections: Span[]): Span[] {
  const spans = detections.map((span, index) => {
    if (
      span.label !== 'SURNAME' ||
      NAME_CONTINUATION.test(raw[span.start - 1] ?? '')
    )
      return span
    const word = SINGLE_NAME_WORD.exec(
      raw.slice(span.start, span.start + 120),
    )?.[0]
    if (!word || word.length <= span.text.length) return span
    const end = span.start + word.length
    if (
      end > (detections[index + 1]?.start ?? raw.length) ||
      NAME_CONTINUATION.test(raw[end] ?? '')
    )
      return span
    return { ...span, end, text: word }
  })
  const surnames = new Map<string, Set<string>>()
  const completed: Span[] = []
  for (let index = 0; index < spans.length; index++) {
    const span = spans[index]
    const next = spans[index + 1]
    if (span.label !== 'GIVEN_NAME') {
      completed.push(span)
      continue
    }

    const fromModel =
      next?.label === 'SURNAME' &&
      next.start > span.end &&
      /^[ \t]+$/u.test(raw.slice(span.end, next.start))
    const inferred =
      span.score >= 0.7 && !fromModel
        ? FOLLOWING_SURNAME.exec(raw.slice(span.end, span.end + 120))
        : null
    const surname = fromModel ? next.text : inferred?.[1]
    const end = fromModel ? next.end : span.end + (inferred?.[0].length ?? 0)
    if (
      !surname ||
      NON_SURNAMES.has(surname.toLowerCase()) ||
      (!fromModel &&
        (NAME_CONTINUATION.test(raw[end] ?? '') ||
          (next !== undefined && next.start < end)))
    ) {
      completed.push(span)
      continue
    }

    if (fromModel) index++
    completed.push({
      ...span,
      end,
      score: fromModel
        ? Math.min(span.score, next.score)
        : Math.min(span.score, 0.79),
      text: raw.slice(span.start, end),
    })
    if (SINGLE_NAME_WORD.exec(span.text)?.[0] !== span.text) continue
    const givenNames = surnames.get(surname) ?? new Set<string>()
    givenNames.add(span.text)
    surnames.set(surname, givenNames)
  }

  for (const match of raw.matchAll(NAME_LINE)) {
    const [, name, surname] = match
    if ((surnames.get(surname)?.size ?? 0) < 2) continue
    const start = match.index + match[0].indexOf(name)
    const end = start + name.length
    if (completed.some((span) => overlaps(span, start, end))) continue
    completed.push({
      start,
      end,
      label: 'GIVEN_NAME',
      source: 'ner',
      score: 0.6,
      text: name,
    })
  }

  return completed.sort(
    (left, right) => left.start - right.start || left.end - right.end,
  )
}
