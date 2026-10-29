import type {
  DocumentModelWire,
  DocumentPdfViewResponse,
  DocumentStoryWire,
  DocumentTextLayoutSegment,
} from '@obiter/contracts'
import {
  documentStory,
  effectiveParagraph,
  paragraphPlainText,
} from './document-model-text'
import {
  flowIds,
  insertPlainText,
  storyBodyParagraphIds,
  storyFlowParagraphIds,
} from './document-story-flow'
import type { EditorState } from './document-word-edits'

export type FindMatchOptions = {
  matchCase: boolean
  wholeWord: boolean
}

export const FIND_MATCH_DEFAULTS: FindMatchOptions = {
  matchCase: false,
  wholeWord: false,
}

export type TextHit = { start: number; end: number }

const WORD_CHAR = /[\p{L}\p{M}\p{N}\p{Pc}]/u
const SPACE_NOT_BREAK = /[^\S\n]/u
const BREAK_UNIT = 0x0a

function unitMatches(needle: number, haystack: number): boolean {
  return (
    needle === haystack ||
    (haystack === BREAK_UNIT &&
      SPACE_NOT_BREAK.test(String.fromCharCode(needle)))
  )
}

const foldText = (text: string) =>
  text.normalize('NFC').toLowerCase().replaceAll('ς', 'σ')

const matchText = (text: string, fold: boolean) =>
  fold ? foldText(text) : text.normalize('NFC')

type MatchSpace = readonly [folded: string, starts: number[], ends: number[]]

const GRAPHEME_SEGMENTER = new Intl.Segmenter()

function matchSpace(text: string, fold: boolean): MatchSpace {
  let produced = ''
  const starts: number[] = []
  const ends: number[] = []
  for (const { segment, index } of GRAPHEME_SEGMENTER.segment(text)) {
    const piece = matchText(segment, fold)
    const end = index + segment.length
    for (let unit = piece.length; unit--;) {
      starts.push(index)
      ends.push(end)
    }
    produced += piece
  }
  return [produced, starts, ends] as const
}

const matchSpaceCache: Array<[string, MatchSpace]> = []

function cachedMatchSpace(text: string, fold: boolean): MatchSpace {
  const key = `${fold}${text}`
  const hit = matchSpaceCache.find(([cached]) => cached === key)
  if (hit) return hit[1]
  const space = matchSpace(text, fold)
  if (matchSpaceCache.length > 3) matchSpaceCache.shift()
  matchSpaceCache.push([key, space])
  return space
}

function isWordAt(text: string, index: number, before = false): boolean {
  const at = index - +before
  const unit = text.charCodeAt(at)
  const codePoint = text.codePointAt(unit >>> 10 === 0x37 ? at - 1 : at)
  return WORD_CHAR.test(String.fromCodePoint(codePoint ?? 0))
}

export function findInText(
  haystack: string,
  needle: string,
  options: FindMatchOptions,
): TextHit[] {
  const fold = !options.matchCase
  const pattern = matchText(needle, fold)
  if (!pattern) return []
  const [folded, starts, ends] = cachedMatchSpace(haystack, fold)
  const hits: TextHit[] = []
  const length = pattern.length
  for (
    let at = 0, matched = 0;
    at + length <= folded.length;
    at += matched === length ? length : 1
  ) {
    for (
      matched = 0;
      matched < length &&
      unitMatches(pattern.charCodeAt(matched), folded.charCodeAt(at + matched));
      matched += 1
    );
    if (matched !== length) continue
    const start = starts[at] ?? at
    const end = ends[at + length - 1] ?? at + length
    if (
      !options.wholeWord ||
      (!isWordAt(haystack, start, true) && !isWordAt(haystack, end))
    ) {
      hits.push({ start, end })
    }
  }
  return hits
}

export type FindHit = {
  from: { paragraphId: string; offset: number }
  to: { paragraphId: string; offset: number }
  segments: Array<{ paragraphId: string; start: number; end: number }>
}

export function findInDocument(
  model: DocumentModelWire | undefined,
  state: EditorState,
  query: string,
  story?: DocumentStoryWire,
  options: FindMatchOptions = FIND_MATCH_DEFAULTS,
): FindHit[] {
  const scoped = model && query ? (story ?? documentStory(model)) : undefined
  if (!scoped) return []
  const joinedIds = storyBodyParagraphIds(scoped)
  flowIds([...joinedIds], state.inserts).forEach((id) => joinedIds.add(id))
  const hits: FindHit[] = []
  const textById = new Map(
    scoped.paragraphs.map((paragraph) => [
      paragraph.id,
      paragraphPlainText(
        effectiveParagraph(
          paragraph,
          state.drafts,
          state.extraRuns[paragraph.id],
        ),
      ),
    ]),
  )
  for (const item of state.inserts) {
    textById.set(item.clientId, insertPlainText(item))
  }
  let flow = ''
  let spans: Array<{ id: string; start: number; end: number }> = []
  const flush = () => {
    let low = 0
    for (const hit of findInText(flow, query, options)) {
      while (low < spans.length && (spans[low]?.end ?? 0) < hit.start) low += 1
      hits.push(resolveHit(hit, spans, low))
    }
    flow = ''
    spans = []
  }
  for (const id of storyFlowParagraphIds(
    scoped,
    state.inserts,
    state.deletedParagraphIds,
  )) {
    const piece = textById.get(id) ?? ''
    if (!joinedIds.has(id)) {
      flush()
      flow = piece
      spans = [{ id, start: 0, end: piece.length }]
      flush()
      continue
    }
    if (spans.length) flow += '\n'
    spans.push({ id, start: flow.length, end: (flow += piece).length })
  }
  flush()
  return hits
}

const hitSlice = (
  hit: TextHit,
  { start, end }: { start: number; end: number },
) => ({
  start: Math.max(hit.start - start, 0),
  end: Math.min(hit.end, end) - start,
})

function resolveHit(
  hit: TextHit,
  spans: ReadonlyArray<{ id: string; start: number; end: number }>,
  low: number,
): FindHit {
  const segments: FindHit['segments'] = []
  for (let index = low; index < spans.length; index += 1) {
    const span = spans[index]
    if (!span || span.start > hit.end) break
    segments.push({ paragraphId: span.id, ...hitSlice(hit, span) })
  }
  const first = segments[0]
  const last = segments.at(-1)
  return {
    from: { paragraphId: first?.paragraphId ?? '', offset: first?.start ?? 0 },
    to: { paragraphId: last?.paragraphId ?? '', offset: last?.end ?? 0 },
    segments,
  }
}

export function clampFindIndex(index: number, count: number): number {
  return index < 0 || index >= count ? -1 : index
}

export function nextFindIndex(hits: readonly unknown[], current: number) {
  return hits.length === 0 ? -1 : (current + 1) % hits.length
}

export function previousFindIndex(hits: readonly unknown[], current: number) {
  return hits.length === 0 ? -1 : current <= 0 ? hits.length - 1 : current - 1
}

export function findMatchLabel(index: number, count: number) {
  return count === 0 || index < 0 ? `${count} found` : `${index + 1}/${count}`
}

type PdfHitSlice = {
  segment: number
  start: number
  end: number
}

export type PdfFindHit = {
  start: number
  end: number
  pageIndex: number
  slices: PdfHitSlice[]
}

export function pdfFindHits(
  view: DocumentPdfViewResponse,
  query: string,
  options: FindMatchOptions,
): PdfFindHit[] {
  if (!query) return []
  const segments = view.layout.segments
  return findInText(view.text, query, options).map((hit) => {
    const { start, end } = hit
    let pageIndex: number | undefined
    const slices: PdfHitSlice[] = []
    let after: DocumentTextLayoutSegment | undefined
    let before: DocumentTextLayoutSegment | undefined
    segments.forEach((segment, index) => {
      if (segment.end <= start) {
        if (!before || segment.end > before.end) before = segment
        return
      }
      if (segment.start >= end) {
        if (!after || segment.start < after.start) after = segment
        return
      }
      pageIndex ??= segment.pageIndex
      slices.push({ segment: index, ...hitSlice(hit, segment) })
    })
    return {
      start,
      end,
      pageIndex: pageIndex ?? after?.pageIndex ?? before?.pageIndex ?? 0,
      slices,
    }
  })
}

export type PdfSliceBounds = { left: number; width: number }

export function pdfSliceBounds(
  { width, start, end }: { width: number; start: number; end: number },
  slice: { start: number; end: number },
): PdfSliceBounds {
  const length = end - start || 1
  return {
    left: (slice.start / length) * width,
    width: ((slice.end - slice.start) / length) * width,
  }
}
