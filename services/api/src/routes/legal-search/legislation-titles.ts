/**
 * Act short-title grammar: the fold applied to a typed title, the stored-title
 * directory, and the whole-title-versus-prose decision.
 *
 * Pure and storage-free. `legislation-citations.ts` owns citation parsing and
 * calls in here for anything about what counts as a title. Keeping the
 * decision here is why the citation module stays under its size ceiling and
 * why the grammar has one home.
 *
 * The joining-word grammar below is closed at compile time. Nothing here reads
 * the directory to build it, so adding or removing a stored Act cannot move
 * how an unrelated query classifies. That was the defect in the previous
 * revision: the vocabulary was mined from the stored titles, so dropping the
 * one title carrying `the` turned `Offences Against the Person Act 1861` from
 * suppression into a keyword search.
 */

import { exactMatchPunctuationFolds } from '@obiter/search-client'

export interface LegislationActDirectoryEntry {
  actType: string
  year: number
  number: number
  identity: string
  title: string
}

export interface LegislationActRef {
  actType: string
  year: number
  number: number
  identity: string
  title: string
}

/**
 * The closed short-title grammar: the lowercase words a short title may carry
 * between its name words — articles and conjunctions, plus the prepositions
 * and lowercase name particles enacted titles use. A lowercase word outside
 * this class ends the title phrase, which is how a clause before an Act is
 * told from a title.
 *
 * The list is enumerated once here and never rebuilt from the directory. That
 * is the whole point: corpus churn must not add `under` or remove `the`,
 * because either would silently change how an unrelated query classifies. It
 * is a grammatical class, not an English stop-word list. `under` is
 * deliberately absent: it introduces a governing clause ("Defences under
 * Children Act 1989"), which is the prose boundary this grammar exists to
 * draw.
 */
export const legislationTitleJoiningWords: readonly string[] = Object.freeze([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'from',
  'during',
  'about',
  'other',
  'plc',
])

const titleJoiningWordSet: ReadonlySet<string> = new Set(
  legislationTitleJoiningWords,
)

/**
 * The one fold applied to both a typed Act title and every stored title.
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
 * - A terminal `(repealed)` status annotation is stripped from the lookup key
 *   only. legislation.gov.uk's dc:title carries the status, but a lawyer
 *   citing the Act never types it, so the canonical citation missed every
 *   repealed Act. The served title keeps the annotation; only the key drops
 *   it. No other parenthetical is stripped: `(Public Lavatories)`,
 *   `(Digital Assets etc)` and friends are part of the short title.
 * - Apostrophes are deleted, not replaced with a space, so a dropped-
 *   apostrophe spelling ("Childrens") converges on the stored ("Children’s").
 * - `&` folds to `and`, a hyphen becomes a space, and the filler token `etc`
 *   is dropped, so the surface forms of a title converge. A hyphen deleted
 *   entirely is left to the relaxed key below.
 */
const terminalStatusAnnotation = /\s*\(repealed\)\s*$/i
const titleFillerTokens = new Set(['etc'])

export function normalizeActTitle(value: string): string {
  const punctuationFolded = exactMatchPunctuationFolds.reduce(
    (normalized, [from, to]) => normalized.replaceAll(from, to),
    value.normalize('NFKC'),
  )
  return punctuationFolded
    .toLowerCase()
    .replace(terminalStatusAnnotation, ' ')
    .replace(/&/g, ' and ')
    .replace(/['\u2019]/g, '')
    .replace(/[.,;:"()[\]]/g, ' ')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0 && !titleFillerTokens.has(token))
    .join(' ')
    .trim()
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
 * The recognised terminal status annotation plus any punctuation after it.
 * Only `(repealed)` is recognised; every other parenthetical is part of a
 * short title or of the query, so it must leave the query prose.
 */
const terminalStatusBoundary =
  /\s*\(\s*repealed\s*\)[\s.,;:!?)\]}"'\u201D\u2019]*$/i

/**
 * The whole-title core of a query: the bounded trailing noise removed.
 *
 * A bare title request may arrive as a sentence (`Children Act 1989.`), inside
 * a search-box quote (`"Children Act 1989"`), or carrying the status
 * annotation legislation.gov.uk appends (`Children Act 1989 (repealed)`).
 * Those are the same request, and none may keyword-serve unrelated provisions.
 * Words and unrecognised parentheticals are not touched, so a phrase that
 * merely resembles a title stays prose. Quotes only come off when they balance
 * around the whole string, so `Children's Rights Act` is left alone.
 */
export function trimTitleBoundary(value: string): string {
  let core = value.trim()
  for (;;) {
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
    core = core.replace(terminalStatusBoundary, '').trim()
    core = core.replace(trailingTitlePunctuation, '').trim()
    if (core === before) return core
  }
}

/**
 * Act-shaped detection: an Act title run followed by `Act <year>`. Section
 * and schedule forms are split before this tests, so only the Act remainder
 * reaches it. `run` is the normalized title run (directory lookup); `rawRun`
 * keeps the casing (structure). Null when the value is not Act-shaped.
 */
interface ActShape {
  run: string
  rawRun: string
}

function actShape(value: string): ActShape | null {
  const match = trimTitleBoundary(value).match(/^(.*?)\bact\b\s*\d{4}\s*$/i)
  if (!match) return null
  const rawRun = (match[1] ?? '').trim()
  return { run: normalizeActTitle(rawRun), rawRun }
}

/**
 * True when the text is an Act-shaped request with a non-empty title run.
 * A bare "Act <year>" has no title words, so it cannot support a title
 * claim; a phrase with at least one letter before "Act" can.
 */
export function looksLikeWholeActTitle(value: string): boolean {
  const shape = actShape(value)
  return Boolean(shape && /[a-z]/.test(shape.run))
}

function actTitleTokens(value: string): string[] {
  return normalizeActTitle(value).split(' ').filter(Boolean)
}

/**
 * True when every word of a run can sit inside an Act short title: a
 * capitalised name, a number, or a lowercase word the closed grammar allows.
 * The run must carry at least one name, so a run of bare connectives ("the")
 * is not a title phrase.
 *
 * Case is read per word, never as the decision. It separates the name words
 * from the joining words so the phrase boundary can be found; an all-uppercase
 * run has no lowercase joining word to find and so reads as one phrase.
 */
function isTitlePhrase(tokens: string[]): boolean {
  let hasName = false
  for (const token of tokens) {
    if (/[A-Z]/.test(token)) {
      hasName = true
      continue
    }
    if (/\d/.test(token)) continue
    // A standalone separator (`Midlands - Crewe`) folds to nothing and is
    // punctuation, not a joining word the grammar can reject the run for.
    const folded = normalizeActTitle(token)
    if (!folded) continue
    if (titleJoiningWordSet.has(folded)) continue
    return false
  }
  return hasName
}

/**
 * Directory and structure evidence that an Act-shaped value is a subject
 * query that merely mentions an Act, not a whole-title request.
 *
 * The determiner test this replaces was a lexical blacklist, and the test that
 * followed it still read sentence-initial capitalisation as evidence of the
 * whole query: "Defences under Children Act 1989" was suppressed while its
 * lowercase twin stayed on the keyword path. This test reads the directory and
 * the query's own phrase structure instead:
 *
 * - A held Act title inside a longer query is proof the query names something
 *   more than that title, so the whole query stays a subject search.
 * - Otherwise the words before `Act <year>` are a title phrase only when every
 *   one of them is a name, a number, or a word in the closed grammar. When the
 *   whole run is such a phrase the query is a whole-title request. When
 *   instead only a proper suffix is, the leading words are a clause and the
 *   citation is part of it: prose, whatever the case of the first word. When
 *   no suffix is a phrase either, a lowercase word outside the grammar is
 *   present, which is no prose evidence, so the safe whole-title suppression
 *   is kept.
 *
 * An underspecified fragment is handled before this: `looksLikeWholeActTitle`
 * rejects a run with no words, so "Act 2020" never reaches a claim.
 */
export function actRemainderIsProse(
  value: string,
  directory: ActDirectory,
): boolean {
  const shape = actShape(value)
  if (!shape) return true
  if (directory.containsTitleRun(actTitleTokens(value))) return true

  const run = shape.rawRun.split(/\s+/).filter(Boolean)
  if (isTitlePhrase(run)) return false
  for (let index = 1; index < run.length; index += 1) {
    if (isTitlePhrase(run.slice(index))) return true
  }
  return false
}

/**
 * Leading function words a citation remainder can carry before the title
 * ("section 2 of the Human Rights Act 1998"). Stripped before matching so the
 * title itself is compared, never the surrounding connector. This is a
 * narrower class than the title grammar above on purpose: these words may be
 * dropped from the front of a title without changing it, which `about` or
 * `during` may not (`about Human Rights Act 1998` is a phrase about the Act,
 * not the Act).
 */
const leadingTitleConnectors = new Set([
  'the',
  'a',
  'an',
  'of',
  'to',
  'in',
  'on',
  'for',
  'and',
  'or',
])

export function stripLeadingTitleConnectors(value: string): string {
  const tokens = value.trim().split(/\s+/)
  let start = 0
  while (
    start < tokens.length - 1 &&
    leadingTitleConnectors.has(
      (tokens[start] ?? '').toLowerCase().replace(/[^a-z]/g, ''),
    )
  ) {
    start += 1
  }
  return tokens.slice(start).join(' ')
}

export interface ActDirectory {
  byYearNumber(
    year: number,
    number: number,
  ): LegislationActDirectoryEntry | null
  byNormalizedTitle(normalized: string): LegislationActDirectoryEntry[]
  byLooseTitle(loose: string): LegislationActDirectoryEntry[]
  allTitles(): LegislationActDirectoryEntry[]
  /** True when a stored Act title occurs as a contiguous token run inside
   * `tokens`, shorter than the whole run. Directory evidence that a longer
   * query merely mentions an Act rather than naming it. */
  containsTitleRun(tokens: string[]): boolean
}

export function createActDirectory(
  entries: LegislationActDirectoryEntry[],
): ActDirectory {
  const byKey = new Map<string, LegislationActDirectoryEntry>()
  const byTitle = new Map<string, LegislationActDirectoryEntry[]>()
  const byLoose = new Map<string, LegislationActDirectoryEntry[]>()
  const titleRuns: string[][] = []
  for (const entry of entries) {
    byKey.set(`${entry.actType}/${entry.year}/${entry.number}`, entry)
    const normalized = normalizeActTitle(entry.title)
    const titleList = byTitle.get(normalized) ?? []
    titleList.push(entry)
    byTitle.set(normalized, titleList)
    const loose = looseActTitleKey(entry.title)
    const looseList = byLoose.get(loose) ?? []
    looseList.push(entry)
    byLoose.set(loose, looseList)
    titleRuns.push(normalized.split(' ').filter(Boolean))
  }
  return {
    byYearNumber: (year, number) =>
      byKey.get(`ukpga/${year}/${number}`) ?? null,
    byNormalizedTitle: (normalized) => byTitle.get(normalized) ?? [],
    byLooseTitle: (loose) => byLoose.get(loose) ?? [],
    allTitles: () => entries,
    containsTitleRun: (tokens) =>
      tokens.length > 1 &&
      titleRuns.some(
        (run) =>
          run.length > 0 &&
          run.length < tokens.length &&
          containsContiguousRun(tokens, run),
      ),
  }
}

function containsContiguousRun(haystack: string[], needle: string[]): boolean {
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let matched = true
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[start + index] !== needle[index]) {
        matched = false
        break
      }
    }
    if (matched) return true
  }
  return false
}

export function toActRef(
  entry: LegislationActDirectoryEntry,
): LegislationActRef {
  return {
    actType: entry.actType,
    year: entry.year,
    number: entry.number,
    identity: entry.identity,
    title: entry.title,
  }
}
