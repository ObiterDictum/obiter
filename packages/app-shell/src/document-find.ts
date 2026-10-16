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

/**
 * The match options the document and PDF find surfaces share. Both are
 * explicit controls in the find group, and find and replace always run with
 * the same options so the hit the user sees is the range the replace rewrites.
 */
export type FindMatchOptions = {
  /** Case-sensitive when true; Unicode default case folding when false. */
  matchCase: boolean
  /** Require each hit to start and end on a word boundary. */
  wholeWord: boolean
}

export const FIND_MATCH_DEFAULTS: FindMatchOptions = {
  matchCase: false,
  wholeWord: false,
}

/** A hit in a searched text, as UTF-16 offsets — the offset space the
 * document model, the editor carets and the PDF text share, so a hit maps
 * back to runs and layout segments without a second coordinate. */
export type TextHit = { start: number; end: number }

/**
 * The characters that count as word characters for a whole-word boundary:
 * letters, combining marks (a mark can never be a boundary on its own —
 * splitting 'e' from its accent is not a word edge), numbers and connector
 * punctuation such as '_'. Everything else — ASCII and non-ASCII punctuation,
 * currency signs, whitespace, the paragraph break — is a boundary.
 */
const WORD_CHAR = /[\p{L}\p{M}\p{N}\p{Pc}]/u
/**
 * The whitespace ECMAScript counts as `\s` minus `\n` itself: a query
 * containing a line break matches a break literally, while other query
 * whitespace — space, tab, NBSP — matches a break because a paragraph or
 * line break reads as space.
 */
const SPACE_NOT_BREAK = /[^\S\n]/u
const BREAK_UNIT = 0x0a

/**
 * The literal match rule: code units must be equal, except that whitespace
 * in the needle also matches a break — the '\n' joining paragraph text in
 * the document find flow, or a `\n` line break inside a paragraph. A break
 * never silently disappears: the hit covers it, so the matched range and the
 * replaced range are the same characters.
 */
function unitMatches(needle: number, haystack: number): boolean {
  return (
    needle === haystack ||
    (haystack === BREAK_UNIT &&
      SPACE_NOT_BREAK.test(String.fromCharCode(needle)))
  )
}

/**
 * The fold both sides of the scan share. `toLowerCase` applies the Unicode
 * default fold — including its one context-sensitive rule, the Greek final
 * sigma: a word-final 'Σ' becomes 'ς'. A grapheme cluster carries no word
 * context, so folding per cluster always yields medial 'σ'. Mapping 'ς'
 * back to 'σ' after the fold makes the two granularities agree — 'σ', 'ς'
 * and 'Σ' are then the same letter for matching, which is also the
 * case-insensitive read the user means.
 */
const foldText = (text: string) =>
  text.normalize('NFC').toLowerCase().replaceAll('ς', 'σ')

/** The transform both sides of a scan take — `foldText` when `fold`, plain
 * NFC otherwise — so a context-sensitive fold can never disagree between
 * the whole-string needle and the per-cluster text. */
const matchText = (text: string, fold: boolean) =>
  fold ? foldText(text) : text.normalize('NFC')

/**
 * Prepare `text` for matching. The text is grouped into grapheme clusters,
 * each cluster is NFC-normalised and — unless `fold` is false — folded with
 * `foldText`, the same transform the whole needle takes, so the two sides
 * can never disagree on a context-sensitive fold. `starts` and `ends` map
 * every UTF-16 unit of the produced text to the original cluster range it
 * came from, so a folded match can never split a surrogate pair, land inside
 * a combining sequence, or be corrupted by a fold that changes length
 * ('İ' folds to 'i' plus a combining dot, two units for one source unit).
 */
type MatchSpace = readonly [folded: string, starts: number[], ends: number[]]

// The default granularity is 'grapheme'.
const GRAPHEME_SEGMENTER = new Intl.Segmenter()

function matchSpace(text: string, fold: boolean): MatchSpace {
  let produced = ''
  const starts: number[] = []
  const ends: number[] = []
  for (const { segment, index } of GRAPHEME_SEGMENTER.segment(text)) {
    const piece = matchText(segment, fold)
    const end = index + segment.length
    // One bounds pair for every UTF-16 unit the piece produced — the loop
    // counts down because the unit value itself is never read.
    for (let unit = piece.length; unit--;) {
      starts.push(index)
      ends.push(end)
    }
    produced += piece
  }
  return [produced, starts, ends] as const
}

/**
 * The folded text and its offset maps are a pure function of the searched
 * text and the fold flag, and they are the expensive half of a scan — the
 * same document re-searched as the query grows must not re-segment it.
 * Bounded to the last few texts (fold on and off), so a query keystroke or
 * an options toggle repays only the linear scan; a document keystroke
 * changes the text and repays the segment cost once, the honest price of
 * keeping hits against live draft state.
 */
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

/** Whether a word character sits at `index` — or ends there when `before`
 * looks at the unit `index - 1`, stepping back over a low surrogate so an
 * astral letter is never halved. */
function isWordAt(text: string, index: number, before = false): boolean {
  const at = index - +before
  // A negative index reads a unit that does not exist — codePointAt yields
  // undefined, which is never a word character.
  const unit = text.charCodeAt(at)
  const codePoint = text.codePointAt(unit >>> 10 === 0x37 ? at - 1 : at)
  return WORD_CHAR.test(String.fromCodePoint(codePoint ?? 0))
}

/**
 * Literal find in one string: no regular expression is built from the
 * needle, so a query means its characters and nothing else. The needle is
 * NFC-normalised and — with `matchCase` off — folded through the same
 * `foldText` the text's clusters take, so a composed 'é' query matches the
 * decomposed 'e'+'́' stored form and a Greek 'ς' query finds 'Σ' and 'σ'.
 * Known limits, deliberately narrow rather than claimed universal: Turkish
 * 'İ' still folds to 'i'+dot above, so 'i' matches it but offsets map to
 * the whole stored letter; the fold is locale-independent — 'I' and 'ı'
 * are different letters everywhere; and 'ß' only ever equals 'ß', never
 * 'ss' — the fold does no multi-letter expansion.
 *
 * Hits are leftmost and non-overlapping, and `wholeWord` then drops a
 * candidate whose edge touches a word character. An empty needle finds
 * nothing.
 */
export function findInText(
  haystack: string,
  needle: string,
  options: FindMatchOptions,
): TextHit[] {
  const fold = !options.matchCase
  // Normalise before folding, matching the cluster order the text takes: a
  // decomposed 'i'+dot composes to 'İ' first and then folds to 'i'+dot,
  // so both sides of the scan hold the same folded units.
  const pattern = matchText(needle, fold)
  if (!pattern) return []
  const [folded, starts, ends] = cachedMatchSpace(haystack, fold)
  const hits: TextHit[] = []
  // The scan runs over the folded pattern, which can be longer than the
  // needle itself when a fold expands — 'İ' folds to 'i' plus a combining
  // dot. Matching the full folded pattern keeps both units honest.
  const length = pattern.length
  // A consumed candidate skips the pattern length whether or not the
  // boundary check keeps it, so the scan is always
  // leftmost-non-overlapping.
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

/**
 * One find hit, as the paragraph-local endpoints the range editors consume.
 * `from` and `to` can sit in different paragraphs when the match covers one
 * or more paragraph breaks — the break belongs to the hit, so the replaced
 * range covers it too. `segments` lists every paragraph the hit reaches with
 * its local slice, including the zero-length slices at the break edges.
 */
export type FindHit = {
  from: { paragraphId: string; offset: number }
  to: { paragraphId: string; offset: number }
  segments: Array<{ paragraphId: string; start: number; end: number }>
}

export function findInDocument(
  model: DocumentModelWire | undefined,
  /** The editor state find reads: stored runs with draft overrides, pending
   * insert paragraphs and joined extraRuns — never the stale saved model. */
  state: EditorState,
  query: string,
  /** The story find scopes to: the workspace passes the story open for
   * editing so a hit can never place the caret outside it. Defaults to the
   * body. */
  story?: DocumentStoryWire,
  options: FindMatchOptions = FIND_MATCH_DEFAULTS,
): FindHit[] {
  const scoped = model && query ? (story ?? documentStory(model)) : undefined
  if (!scoped) return []
  // The ids whose text joins the flow: the story's body paragraphs, plus
  // whichever pending inserts the same flow walk weaves in at them — an
  // insert anchored to a cell, a text box or another story's paragraph is
  // searched alone like the paragraph it belongs to.
  const joinedIds = storyBodyParagraphIds(scoped)
  flowIds([...joinedIds], state.inserts).forEach((id) => joinedIds.add(id))
  const hits: FindHit[] = []
  // `blockText` resolves each id by scanning every editable story — quadratic
  // across a long document's flow — so the same effective text is indexed
  // once here: an insert's text, or the paragraph's runs plus its joined
  // extraRuns with text drafts applied.
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
  // Ordinary flow paragraphs join into one match run with a '\n' for each
  // break, so a literal query crosses a paragraph the way it reads. A
  // structural paragraph — a table cell, a text box — is searched alone: its
  // edges are not paragraph marks, so a hit may never silently bridge the
  // container the way two unrelated texts were concatenated.
  let flow = ''
  let spans: Array<{ id: string; start: number; end: number }> = []
  const flush = () => {
    // Hits and spans are both in text order, so each hit picks the walk up
    // where the last left it — the mapping stays linear in the spans rather
    // than rescanning every span for every hit.
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
      // Search the structural paragraph alone: its edges are not paragraph
      // marks, so a hit may never silently bridge the container the way two
      // unrelated texts were concatenated.
      flush()
      flow = piece
      spans = [{ id, start: 0, end: piece.length }]
      flush()
      continue
    }
    // The break belongs to every boundary, including the ones around an
    // empty paragraph — an empty paragraph's text is '', not no break.
    if (spans.length) flow += '\n'
    spans.push({ id, start: flow.length, end: (flow += piece).length })
  }
  flush()
  return hits
}

/** The part of `span`'s local range `hit` covers. */
const hitSlice = (
  hit: TextHit,
  { start, end }: { start: number; end: number },
) => ({
  start: Math.max(hit.start - start, 0),
  end: Math.min(hit.end, end) - start,
})

/**
 * Map a hit in the joined flow text back to paragraph-local endpoints.
 * `segments` covers every paragraph the hit range touches — including a
 * zero-length slice where the range only reaches a paragraph's edge, because
 * a paragraph owns the break position after its text — so `from` and `to`
 * are the first and last covered slices read as endpoints.
 */
function resolveHit(
  hit: TextHit,
  spans: ReadonlyArray<{ id: string; start: number; end: number }>,
  low: number,
): FindHit {
  // Spans are appended in text order and `low` already sits on the first
  // one whose end reaches the hit, so every span read here ends at or past
  // the hit's start. The covered window ends at the first span starting
  // past the hit — nothing later can overlap it.
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

/**
 * The slice of one layout segment a PDF hit covers, as offsets into the
 * segment's own text (`segment.start`..`segment.end` over `view.text`).
 */
export type PdfHitSlice = {
  /** Index into `view.layout.segments`. */
  segment: number
  start: number
  end: number
}

/**
 * A find hit in the extracted PDF text. `pageIndex` is where navigation
 * lands — the page of the first covered segment — and `slices` is every
 * segment part the hit covers, so the viewer can highlight the match without
 * re-deriving it from offsets.
 */
export type PdfFindHit = {
  start: number
  end: number
  pageIndex: number
  slices: PdfHitSlice[]
}

/**
 * Literal find over the PDF's extracted text, mapping each hit to the layout
 * segments it covers. The text the API serves is segment text in reading
 * order, so a hit can span segment boundaries — and even a page boundary,
 * where the extracted text itself continues across the break. That is the
 * honest limit of the match space: the original PDF's line breaks, hyphen
 * splits and column order are whatever the extractor emitted, and a query
 * only finds the text as it was extracted.
 *
 * A hit resolves its slices by scanning the segments once, so a keystroke
 * costs a linear scan over the text and the segments — the fold's match
 * space is memoised on the text, so only an actual text change re-segments
 * it. That is the search cost, distinct from the rendering bound: no DOM
 * work happens here and the mounted page stays bounded the way the viewer
 * already bounds it.
 */
export function pdfFindHits(
  view: DocumentPdfViewResponse,
  query: string,
  options: FindMatchOptions,
): PdfFindHit[] {
  if (!query) return []
  const segments = view.layout.segments
  // Segment starts are monotone in the emitted layout, but nothing in the
  // contract orders them, so a hit resolves against every overlapping
  // segment rather than an assumed order.
  return findInText(view.text, query, options).map((hit) => {
    const { start, end } = hit
    let pageIndex: number | undefined
    const slices: PdfHitSlice[] = []
    // A hit no segment covers still needs an honest page: the nearest
    // segment after its text — the smallest start offset, array order
    // breaking a tie — else the nearest ending before it, else page 0 when
    // the layout has no segments at all. Both fallbacks are tracked in the
    // same pass the slices are.
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

/**
 * The horizontal bounds of a covered slice inside its segment's box,
 * interpolated proportionally — the approximation the layout itself already
 * uses to place the segment's text span, so a highlight sits where the text
 * the viewer shows actually lands.
 */
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
