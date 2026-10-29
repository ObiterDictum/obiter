import type { PiiLabel, Span } from '../types'

interface RawEntity {
  readonly entity_group?: string
  readonly entity?: string
  readonly score: number
  readonly start: number
  readonly end: number
  readonly word: string
  readonly index?: number
}

type TokenCounter = (text: string) => number

export interface TokenClassifier {
  (
    text: string,
    options?: { aggregation_strategy?: 'simple' | 'first' | 'max' },
  ): Promise<RawEntity[]>
  countTokens?: TokenCounter
  tokenize?: (text: string) => readonly string[]
}

const GROUP_TO_LABEL: Readonly<Record<string, PiiLabel>> = {
  GIVEN_NAME: 'GIVEN_NAME',
  GIVENNAME: 'GIVEN_NAME',
  SURNAME: 'SURNAME',
  LASTNAME: 'SURNAME',
  EMAIL: 'EMAIL',
  PHONE: 'PHONE',
  URL: 'URL',
  TAX_ID: 'TAX_ID',
  BANK_ACCOUNT: 'BANK_ACCOUNT',
  ROUTING_NUMBER: 'ROUTING_NUMBER',
  GOVERNMENT_ID: 'GOVERNMENT_ID',
  PASSPORT: 'PASSPORT',
  DRIVERS_LICENSE: 'DRIVERS_LICENSE',
  BUILDING_NUMBER: 'BUILDING_NUMBER',
  STREET_NAME: 'STREET_NAME',
  SECONDARY_ADDRESS: 'SECONDARY_ADDRESS',
  SECADDRESS: 'SECONDARY_ADDRESS',
  CITY: 'CITY',
  STATE: 'STATE',
  ZIP_CODE: 'ZIP_CODE',
}

export const RAMPART_MODEL_ID = 'qarlus/rampart'
export const RAMPART_MODEL_REVISION = 'c3221c5cd838eb69a249ab40f8b442483865f233'

export interface NerOptions {
  readonly model?: string
  readonly device?: 'wasm' | 'webgpu' | 'cpu'
  readonly minScore?: number
  readonly revision?: string
  readonly cacheDir?: string
}

const DEFAULT_OPTIONS: Required<Pick<NerOptions, 'device' | 'minScore'>> = {
  device: 'wasm',
  minScore: 0.4,
}

const MODEL_MAX_TOKENS = 512
const SPECIAL_TOKENS = 2
export const NER_TOKEN_BUDGET = MODEL_MAX_TOKENS - SPECIAL_TOKENS - 10
export const NER_DEFAULT_CHUNK_TOKENS = 400

export const NER_TOKEN_OVERLAP = 64

const COMBINING_MARKS_RE = /\p{M}/gu

const EXTEND_SCORE = 0.15
const CONNECTOR_RE = /^[ \t'\u2019.-]*$/
const PERSON_LABELS: ReadonlySet<PiiLabel> = new Set(['GIVEN_NAME', 'SURNAME'])
const LEFT_PARTICLE_RE =
  /([\p{Lu}][\p{L}\p{M}\u2019']{0,3})([ \t'\u2019.-]{1,3})$/u
const RIGHT_PARTICLE_RE =
  /^([ \t'\u2019.-]{1,3})([\p{Lu}][\p{L}\p{M}\u2019']{0,3})/u
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

export async function loadNerClassifier(
  options: NerOptions = {},
): Promise<TokenClassifier> {
  const { pipeline, env } = await import('@huggingface/transformers')
  const merged = { ...DEFAULT_OPTIONS, ...options }
  const model = merged.model ?? RAMPART_MODEL_ID
  if (options.cacheDir) env.cacheDir = options.cacheDir
  const classifier = await pipeline('token-classification', model, {
    dtype: 'q4',
    device: merged.device,
    revision: options.revision ?? RAMPART_MODEL_REVISION,
  })
  const adapter: TokenClassifier = (text, opts) =>
    (classifier as (input: string, options?: unknown) => Promise<RawEntity[]>)(
      text,
      opts,
    )
  const tokenizer = (
    classifier as unknown as {
      tokenizer?: {
        encode?: (t: string, o?: { add_special_tokens?: boolean }) => number[]
        tokenize?: (t: string) => string[]
      }
    }
  ).tokenizer
  if (tokenizer?.encode) {
    adapter.countTokens = (text) =>
      tokenizer.encode!(text, { add_special_tokens: false }).length
  }
  if (tokenizer?.tokenize) {
    adapter.tokenize = (text) => tokenizer.tokenize!(text)
  }
  return adapter
}

export async function detectNer(
  raw: string,
  classifier: TokenClassifier,
  minScore: number = DEFAULT_OPTIONS.minScore,
  chunkTokens: number = NER_DEFAULT_CHUNK_TOKENS,
): Promise<Span[]> {
  const windows =
    classifier.countTokens === undefined
      ? [{ start: 0, end: raw.length }]
      : planTokenWindows(
          raw,
          classifier.countTokens,
          chunkTokens,
          NER_TOKEN_OVERLAP,
        )

  if (windows.length <= 1) {
    return detectNerWindow(raw, classifier, minScore)
  }

  const spans: Span[] = []
  for (const window of windows) {
    const windowSpans = await detectNerWindow(
      raw.slice(window.start, window.end),
      classifier,
      minScore,
    )
    for (const span of windowSpans) {
      spans.push({
        ...span,
        start: span.start + window.start,
        end: span.end + window.start,
      })
    }
  }
  return dedupeExactSpans(spans)
}

function dedupeExactSpans(spans: readonly Span[]): Span[] {
  const seen = new Set<string>()
  const unique: Span[] = []
  for (const span of spans) {
    const key = `${span.start}:${span.end}:${span.label}:${span.source}:${span.score}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(span)
  }
  return unique.sort(
    (left, right) => left.start - right.start || left.end - right.end,
  )
}

interface CharWindow {
  readonly start: number
  readonly end: number
}

function planTokenWindows(
  raw: string,
  countTokens: TokenCounter,
  budget: number,
  overlap: number,
): CharWindow[] {
  const segments = toSegments(raw, countTokens, budget, overlap)
  if (segments.length === 0) return []

  const windows: CharWindow[] = []
  let i = 0
  while (i < segments.length) {
    let tokens = 0
    let j = i
    while (
      j < segments.length &&
      (j === i || tokens + segments[j].tokens <= budget)
    ) {
      tokens += segments[j].tokens
      j++
    }
    windows.push({ start: segments[i].start, end: segments[j - 1].end })
    if (j === segments.length) break

    let shared = 0
    let next = j
    while (next > i + 1 && shared < overlap) {
      next--
      shared += segments[next].tokens
    }
    i = next
  }
  return windows
}

interface Segment {
  readonly start: number
  readonly end: number
  readonly tokens: number
}

function toSegments(
  raw: string,
  countTokens: TokenCounter,
  budget: number,
  overlap: number,
): Segment[] {
  const segments: Segment[] = []
  for (const [start, end] of wordSpans(raw)) {
    let from = start
    while (from < end) {
      const tokens = countTokens(raw.slice(from, end))
      if (tokens <= budget) {
        segments.push({ start: from, end, tokens })
        break
      }
      const cut = fitCharsToBudget(raw, from, end, budget, countTokens)
      segments.push({
        start: from,
        end: cut,
        tokens: countTokens(raw.slice(from, cut)),
      })
      from = overlapStart(raw, from, cut, overlap, countTokens)
    }
  }
  return segments
}

function overlapStart(
  raw: string,
  from: number,
  cut: number,
  overlap: number,
  countTokens: TokenCounter,
): number {
  let start = cut
  while (start > from && countTokens(raw.slice(start, cut)) < overlap) start--
  return start === from ? Math.min(cut, from + 1) : start
}

function* wordSpans(raw: string): Generator<[number, number]> {
  const n = raw.length
  let i = 0
  while (i < n) {
    let j = i
    while (j < n && !/\s/.test(raw[j])) j++
    while (j < n && /\s/.test(raw[j])) j++
    yield [i, j]
    i = j
  }
}

function fitCharsToBudget(
  raw: string,
  from: number,
  end: number,
  budget: number,
  countTokens: TokenCounter,
): number {
  let lo = from + 1
  let hi = end
  let best = from + 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (countTokens(raw.slice(from, mid)) <= budget) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

async function detectNerWindow(
  raw: string,
  classifier: TokenClassifier,
  minScore: number = DEFAULT_OPTIONS.minScore,
): Promise<Span[]> {
  const inferText = raw.replaceAll('-', ' ')
  const entities = await classifier(inferText, {
    aggregation_strategy: 'simple',
  })
  const folded = foldForModel(inferText)
  const indexOffsets =
    classifier.tokenize === undefined
      ? undefined
      : buildTokenIndexOffsets(folded, classifier.tokenize(inferText))
  const candidates: Span[] = []
  for (const entity of mergeBioTokens(entities, folded, indexOffsets)) {
    const label = GROUP_TO_LABEL[entity.group.toUpperCase()]
    if (label === undefined) continue
    if (entity.score < EXTEND_SCORE || entity.end <= entity.start) continue
    candidates.push({
      start: entity.start,
      end: entity.end,
      label,
      score: entity.score,
      source: 'ner',
      text: raw.slice(entity.start, entity.end),
    })
  }
  return repairSpans(raw, candidates, minScore)
}

interface AggregatedEntity {
  group: string
  score: number
  start: number
  end: number
}

function stripBio(label: string): { prefix: 'B' | 'I' | null; base: string } {
  const m = /^([BI])-(.+)$/.exec(label)
  return m
    ? { prefix: m[1] as 'B' | 'I', base: m[2] }
    : { prefix: null, base: label }
}

interface FoldedProjection {
  readonly text: string
  readonly rawStart: number[]
  readonly rawEnd: number[]
}

function foldForModel(raw: string): FoldedProjection {
  let text = ''
  const rawStart: number[] = []
  const rawEnd: number[] = []
  let i = 0
  for (const codePoint of raw) {
    const folded = codePoint
      .toLowerCase()
      .normalize('NFKD')
      .replace(COMBINING_MARKS_RE, '')
    const start = i
    i += codePoint.length
    for (let unit = 0; unit < folded.length; unit++) {
      rawStart.push(start)
      rawEnd.push(i)
    }
    text += folded
  }
  return { text, rawStart, rawEnd }
}

function buildTokenIndexOffsets(
  folded: FoldedProjection,
  contentTokens: readonly string[],
): ReadonlyArray<readonly [number, number]> {
  const offsets: [number, number][] = [[0, 0]]
  let cursor = 0
  for (const token of contentTokens) {
    const piece = token.startsWith('##') ? token.slice(2) : token
    const at = token.startsWith('##')
      ? cursor
      : folded.text.indexOf(piece, cursor)
    if (
      piece.length === 0 ||
      at < 0 ||
      at + piece.length > folded.text.length
    ) {
      offsets.push([0, 0])
      continue
    }
    offsets.push([folded.rawStart[at], folded.rawEnd[at + piece.length - 1]])
    cursor = at + piece.length
  }
  offsets.push([0, 0])
  return offsets
}

function offsetFromTokenIndex(
  indexOffsets: ReadonlyArray<readonly [number, number]> | undefined,
  index: number | undefined,
): readonly [number, number] | null {
  if (indexOffsets === undefined || index === undefined) return null
  const pair = indexOffsets[index]
  if (pair === undefined || pair[0] === pair[1]) return null
  return pair
}

function mergeBioTokens(
  entities: RawEntity[],
  folded: FoldedProjection,
  indexOffsets?: ReadonlyArray<readonly [number, number]>,
): AggregatedEntity[] {
  const out: AggregatedEntity[] = []
  let cursor = 0
  let current: (AggregatedEntity & { count: number }) | null = null

  const flush = (): void => {
    if (current !== null) {
      out.push({
        group: current.group,
        score: current.score / current.count,
        start: current.start,
        end: current.end,
      })
      current = null
    }
  }

  for (const entity of entities) {
    if (
      entity.entity_group !== undefined &&
      typeof entity.start === 'number' &&
      typeof entity.end === 'number'
    ) {
      flush()
      out.push({
        group: entity.entity_group,
        score: entity.score,
        start: entity.start,
        end: entity.end,
      })
      continue
    }
    const rawLabel = entity.entity ?? entity.entity_group
    if (rawLabel === undefined) continue
    const { prefix, base } = stripBio(rawLabel)

    const indexed = offsetFromTokenIndex(indexOffsets, entity.index)
    let start: number
    let end: number
    if (indexed !== null) {
      ;[start, end] = indexed
    } else {
      const word = (entity.word ?? '').replace(/^##/, '').toLowerCase()
      if (!word) continue
      const at = folded.text.indexOf(word, cursor)
      if (at < 0) continue
      start = folded.rawStart[at]
      end = folded.rawEnd[at + word.length - 1]
      cursor = at + word.length
    }

    const isSubword = (entity.word ?? '').startsWith('##')
    const continues =
      current !== null &&
      current.group === base &&
      (prefix !== 'B' || isSubword)
    if (continues && current !== null) {
      current.end = end
      current.score += entity.score
      current.count += 1
    } else {
      flush()
      current = { group: base, score: entity.score, start, end, count: 1 }
    }
  }
  flush()
  return out
}

function repairSpans(
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
