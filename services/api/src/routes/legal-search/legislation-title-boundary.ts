/**
 * The one fold applied to a typed Act title and to every stored title, and the
 * bounded trimming of the presentation wrappers a whole-title request may
 * carry.
 *
 * Pure and storage-free, with no grammar and no directory: the title phrase
 * test and the stored-title directory live in `legislation-titles.ts`. Keeping
 * the fold here means there is exactly one normalisation, and the boundary
 * rules are a closed, data-driven list rather than a prose-stripping pass.
 */

import { exactMatchPunctuationFolds } from '@obiter/search-client'

/**
 * The terminal `(repealed)` status annotation stripped from a lookup key only.
 * legislation.gov.uk's dc:title carries the status, but a lawyer citing the
 * Act never types it, so the canonical citation missed every repealed Act. The
 * served title keeps the annotation; only the key drops it. No other
 * parenthetical is stripped: `(Public Lavatories)`, `(Digital Assets etc)` and
 * friends are part of the short title.
 */
const terminalStatusAnnotation = /\s*\(repealed\)\s*$/i

const titleFillerTokens = new Set(['etc'])

/**
 * Punctuation that ends a title piece. Brackets belong here with the rest:
 * parentheses, square brackets and curly brackets are all presentation around
 * a run, never a name, so the three fold the same way. A hyphen becomes a
 * separator and is handled beside them.
 */
const titleSeparatorCharacters = new Set([
  '.',
  ',',
  ';',
  ':',
  '"',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  '-',
])

/** A surviving piece of the fold, with the span it occupied in the input. */
export interface FoldedTitlePiece {
  value: string
  /** Character index in the input where the surviving text starts. */
  start: number
  /** Character index just after the surviving text. */
  end: number
}

/**
 * The fold applied to both a typed Act title and every stored title, piece by
 * piece and carrying each surviving piece's character span.
 *
 * NFKC plus the shared quote/dash map (`exactMatchPunctuationFolds`, the same
 * fold neutral-citation matching uses), then case, punctuation and whitespace
 * folding. Folding one side only trades a failure for its mirror: the stored
 * title carries U+2019 (Renters’ Rights Act 2025) while a UK keyboard emits
 * the straight apostrophe. NFKC also folds the non-breaking spaces Word and
 * Google Docs paste in.
 *
 * Three deliberate choices make the fold converge on the forms people type:
 *
 * - A terminal `(repealed)` status annotation is stripped from the key only.
 * - Apostrophes are deleted, not replaced with a space, so a dropped-
 *   apostrophe spelling ("Childrens") converges on the stored ("Children’s").
 * - `&` folds to `and`, a hyphen becomes a space, and the filler token `etc`
 *   is dropped, so the surface forms of a title converge. A hyphen deleted
 *   entirely is left to the relaxed key below.
 *
 * The spans exist for the bracket boundary: the fold turns a bracket into a
 * separator, so the text of `(Equality` starts *after* the `(`. A caller that
 * asks where a piece sits in the input can see the opener that a rule reading
 * only raw token boundaries misses, and can tell an opener that precedes the
 * title text from one that follows it in the same token. Keeping the spans in
 * the one fold stops them drifting from the text the matcher folds.
 */
export function foldTitlePieces(value: string): FoldedTitlePiece[] {
  const source = value.normalize('NFKC')
  // The status annotation is terminal on the string handed in, so cutting it
  // first leaves every earlier character's offset unchanged.
  const status = terminalStatusAnnotation.exec(source)
  const text = status ? source.slice(0, status.index) : source
  const characters: Array<{ character: string; offset: number }> = []
  for (let index = 0; index < text.length; index += 1) {
    let character = text[index]!
    for (const [from, to] of exactMatchPunctuationFolds) {
      character = character.replaceAll(from, to)
    }
    character = character.toLowerCase()
    if (character === '&') {
      for (const replacement of ' and ') {
        characters.push({ character: replacement, offset: index })
      }
      continue
    }
    if (character === "'") continue
    if (/\s/.test(character) || titleSeparatorCharacters.has(character)) {
      characters.push({ character: ' ', offset: index })
      continue
    }
    characters.push({ character, offset: index })
  }
  const pieces: FoldedTitlePiece[] = []
  let current: FoldedTitlePiece | null = null
  for (const { character, offset } of characters) {
    if (character === ' ') {
      if (current) pieces.push(current)
      current = null
      continue
    }
    if (!current) current = { value: '', start: offset, end: offset + 1 }
    current.value += character
    current.end = offset + 1
  }
  if (current) pieces.push(current)
  return pieces.filter(
    (piece) => piece.value.length > 0 && !titleFillerTokens.has(piece.value),
  )
}

/**
 * The fold as text: the surviving pieces joined by a single space. Defined
 * from `foldTitlePieces` so the matcher and the span-aware bracket boundary
 * can never fold the same input two ways.
 */
export function normalizeActTitle(value: string): string {
  return foldTitlePieces(value)
    .map((piece) => piece.value)
    .join(' ')
}

/** A folded piece of a whole query, attributed to its raw token and span. */
export interface FoldQueryPiece {
  value: string
  /** Index of the whitespace-separated raw token the piece came from. */
  rawIndex: number
  /** Character index in the query where the surviving text starts. */
  start: number
  /** Character index just after the surviving text. */
  end: number
}

/**
 * Fold a whole query into pieces, each attributed to the raw token it came
 * from and carrying its character span. The input must already be
 * NFKC-normalised: the spans index that string.
 */
export function foldQueryPieces(value: string): FoldQueryPiece[] {
  const pieces: FoldQueryPiece[] = []
  let rawIndex = 0
  for (const match of value.matchAll(/\S+/g)) {
    const text = match[0]
    const offset = match.index ?? 0
    for (const piece of foldTitlePieces(text)) {
      pieces.push({
        value: piece.value,
        rawIndex,
        start: offset + piece.start,
        end: offset + piece.end,
      })
    }
    rawIndex += 1
  }
  return pieces
}

/**
 * Parentheses, square brackets and curly brackets pair within their own
 * family. The depth count is shared, so an unmatched opener still reads as
 * open and the classification errs toward suppression.
 */
const openingToClosing: ReadonlyMap<string, string> = new Map([
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
])
const closingToOpening: ReadonlyMap<string, string> = new Map(
  [...openingToClosing].map(([opening, closing]) => [closing, opening]),
)

export interface BracketStructure {
  /** Unmatched-opener count immediately before each character of the input. */
  depthBefore: number[]
  /** False when a bracket is unmatched or pairs with the wrong family. */
  balanced: boolean
}

/**
 * Read the bracket structure of `value`. The three families are
 * interchangeable for depth but pair only within their own family, so
 * parentheses, square brackets and curly brackets follow one rule.
 *
 * `balanced` is the conservative signal: an unmatched or mismatched bracket
 * marks the whole query malformed, and a malformed query suppresses rather
 * than keyword-serving provisions of an unrelated Act.
 */
export function readBracketStructure(value: string): BracketStructure {
  const depthBefore = Array.from({ length: value.length + 1 }, () => 0)
  const open: string[] = []
  let depth = 0
  let balanced = true
  for (let index = 0; index < value.length; index += 1) {
    depthBefore[index] = depth
    const character = value[index]!
    if (openingToClosing.has(character)) {
      open.push(character)
      depth += 1
      continue
    }
    const opening = closingToOpening.get(character)
    if (opening === undefined) continue
    if (open.pop() !== opening) balanced = false
    depth = Math.max(0, depth - 1)
  }
  depthBefore[value.length] = depth
  if (depth !== 0) balanced = false
  return { depthBefore, balanced }
}

/**
 * The relaxed key: whitespace and the remaining punctuation are removed, so a
 * deleted hyphen (`Cooperatives` vs `Co-operatives`) converges too. It is only
 * consulted when the strict key misses, and a relaxed key that matches more
 * than one stored Act is ambiguous, never a silent winner.
 */
export function looseActTitleKey(value: string): string {
  return normalizeActTitle(value).replace(/[^a-z0-9]/g, '')
}

/** Quote pairs whose balanced ends may wrap a whole-title request. */
const wrappingQuotes: ReadonlyMap<string, string> = new Map([
  ['"', '"'],
  ["'", "'"],
  ['\u201C', '\u201D'],
  ['\u2018', '\u2019'],
])

/**
 * Punctuation, whitespace and unmatched closing wrappers a whole-title
 * request may trail. Bounded on purpose: only these characters, never a word,
 * so `Children Act 1989 extra` is not a standalone title.
 */
const trailingTitlePunctuation = /[\s.,;:!?)\]}"'\u201D\u2019]+$/

/**
 * The recognised terminal presentation annotations, as an explicit closed
 * list. A whole-title request may carry the status legislation.gov.uk
 * appends, or the conventional `, as amended` qualifier; both are
 * presentation metadata, not part of the short title. Nothing else is
 * stripped, so `as applied`, `as interpreted`, `as amended by <Act>` and
 * every other trailing clause leave the query prose. The qualifier is
 * terminal and comma-anchored: `as amended by the Courts Act 2003` ends in a
 * year, not in `as amended`, and never matches.
 */
const terminalPresentationAnnotations: readonly string[] = Object.freeze([
  String.raw`\s*\(\s*repealed\s*\)`,
  String.raw`\s*,\s*as\s+amended`,
])

/**
 * One recognised annotation plus any punctuation after it, anchored to the
 * end. Applied repeatedly by `stripTerminalPresentation`, never as an
 * unbounded run: the alternation is a literal list and the trailing class is
 * bounded, so the pattern cannot backtrack the way a nested `(...[...]*)+`
 * could.
 */
const terminalPresentationBoundary = new RegExp(
  `(?:${terminalPresentationAnnotations.join('|')})[\\s.,;:!?)\\]}"'\u201D\u2019]*$`,
  'i',
)

/**
 * Strip every recognised terminal presentation annotation, to a bounded
 * fixpoint.
 *
 * Each successful strip removes at least one occurrence of `repealed` or
 * `amended`, so a budget derived from those occurrences is provably
 * sufficient: a doubled or tripled annotation comes off in full before the
 * generic trailing-punctuation trim runs, and a pathological input (hundreds
 * of repeated annotations) stays linear. The bound is what keeps this from
 * being a "repeat until unchanged" parser.
 */
function stripTerminalPresentation(value: string): string {
  let core = value
  const budget = (value.match(/repealed|amended/gi) ?? []).length
  for (let pass = 0; pass <= budget; pass += 1) {
    const next = core.replace(terminalPresentationBoundary, '').trim()
    if (next === core) return core
    core = next
  }
  return core
}

/**
 * A small fixed ceiling on the outer quote/punctuation passes. Quotes nest at
 * most a couple of deep and punctuation runs collapse in one pass, so the
 * ceiling is generous; it exists so a future annotation cannot make the outer
 * loop open-ended.
 */
const maxBoundaryPasses = 8

/**
 * The whole-title core of a query: the bounded trailing noise removed.
 *
 * A bare title request may arrive as a sentence (`Children Act 1989.`), inside
 * a search-box quote (`"Children Act 1989"`), carrying the status annotation
 * legislation.gov.uk appends (`Children Act 1989 (repealed)`), or with the
 * conventional `, as amended` qualifier. Those are the same request, and none
 * may keyword-serve unrelated provisions. Words and unrecognised
 * parentheticals are not touched, so a phrase that merely resembles a title
 * stays prose. Quotes only come off when they balance around the whole string,
 * so `Children's Rights Act` is left alone.
 */
export function trimTitleBoundary(value: string): string {
  let core = value.trim()
  for (let pass = 0; pass < maxBoundaryPasses; pass += 1) {
    const before = core
    const first = core[0]
    const last = core[core.length - 1]
    if (
      first !== undefined &&
      last !== undefined &&
      wrappingQuotes.get(first) === last
    ) {
      core = core.slice(1, -1).trim()
    }
    // Presentation annotations come off before the generic punctuation trim,
    // so a remaining `(repealed)` is never left with its closing bracket eaten.
    core = stripTerminalPresentation(core)
    core = core.replace(trailingTitlePunctuation, '').trim()
    if (core === before) return core
  }
  return core
}
