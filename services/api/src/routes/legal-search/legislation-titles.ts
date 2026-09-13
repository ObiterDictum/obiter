/**
 * Act short-title grammar and the stored-title directory: the phrase test
 * that decides whether an Act-shaped query is a whole-title request or a
 * clause about one, and the directory evidence it reads.
 *
 * Pure and storage-free. The fold and the bounded trailing-presentation
 * trimming live in `legislation-title-boundary.ts` (one home for the fold);
 * `legislation-citations.ts` owns citation parsing and calls in here for
 * anything about what counts as a title.
 *
 * The joining-word grammar below is closed at compile time. Nothing here reads
 * the directory to build it, so adding or removing a stored Act cannot move
 * how an unrelated query classifies. That was the defect in an earlier
 * revision: the vocabulary was mined from the stored titles, so dropping the
 * one title carrying `the` turned `Offences Against the Person Act 1861` from
 * suppression into a keyword search.
 */

import {
  foldQueryPieces,
  readBracketStructure,
  looseActTitleKey,
  normalizeActTitle,
  trimTitleBoundary,
  type FoldQueryPiece,
} from './legislation-title-boundary'

export {
  looseActTitleKey,
  normalizeActTitle,
  trimTitleBoundary,
} from './legislation-title-boundary'

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
 * Act-shaped detection: an Act title run followed by `Act <year>`. Section
 * and schedule forms are split before this tests, so only the Act remainder
 * reaches it. `core` is the boundary-trimmed query; `run` is the normalized
 * title run (directory lookup); `rawRun` keeps the casing (structure). Null
 * when the value is not Act-shaped.
 */
interface ActShape {
  core: string
  run: string
  rawRun: string
}

function actShape(value: string): ActShape | null {
  const core = trimTitleBoundary(value)
  const match = core.match(/^(.*?)\bact\b\s*\d{4}\s*$/i)
  if (!match) return null
  const rawRun = (match[1] ?? '').trim()
  return { core, run: normalizeActTitle(rawRun), rawRun }
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
function isTitlePhrase(tokens: readonly string[]): boolean {
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
 * Every position at which a contained held-title run occurs in `pieces`, as
 * the half-open piece range it covers. The residue and the bracket test read
 * the same matches, so they cannot disagree about what the contained run is.
 */
function containedRunMatches(
  pieces: readonly FoldQueryPiece[],
  containedRuns: readonly (readonly string[])[],
): Array<{ start: number; end: number }> {
  const matches: Array<{ start: number; end: number }> = []
  for (const run of containedRuns) {
    for (let start = 0; start + run.length <= pieces.length; start += 1) {
      let matched = true
      for (let offset = 0; offset < run.length; offset += 1) {
        if (pieces[start + offset]?.value !== run[offset]) {
          matched = false
          break
        }
      }
      if (matched) matches.push({ start, end: start + run.length })
    }
  }
  return matches
}

/**
 * The raw tokens of `core` left after every contained held-title run is
 * removed, preserving each surviving token's original casing so the phrase
 * test still separates name words from joining words.
 *
 * Normalisation can split one raw token into several pieces (a hyphen or a
 * bracket becomes a separator), and a run is matched over those pieces. A
 * token that holds only part of a run cannot be split back into outer text and
 * title text, so it is dropped only when *every* piece it folds to belongs to
 * a contained run. Dropping it on a single covered piece would discard outer
 * words that share the token (`under(equality ...)`), letting genuine prose
 * read as a title phrase and be suppressed. Keeping a straddling token leaves
 * some run words in the residue, which can only make the residue less
 * title-shaped, never more.
 */
function residueTitleTokens(
  core: string,
  containedRuns: readonly (readonly string[])[],
): string[] {
  const normalized = core.normalize('NFKC')
  const rawTokens = normalized.split(/\s+/).filter(Boolean)
  const pieces = foldQueryPieces(normalized)
  const covered: boolean[] = Array.from({ length: pieces.length }, () => false)
  for (const match of containedRunMatches(pieces, containedRuns)) {
    for (let index = match.start; index < match.end; index += 1) {
      covered[index] = true
    }
  }
  const totalPerToken = new Map<number, number>()
  const coveredPerToken = new Map<number, number>()
  for (let index = 0; index < pieces.length; index += 1) {
    const rawIndex = pieces[index]!.rawIndex
    totalPerToken.set(rawIndex, (totalPerToken.get(rawIndex) ?? 0) + 1)
    if (covered[index]) {
      coveredPerToken.set(rawIndex, (coveredPerToken.get(rawIndex) ?? 0) + 1)
    }
  }
  const residue: string[] = []
  for (let rawIndex = 0; rawIndex < rawTokens.length; rawIndex += 1) {
    const total = totalPerToken.get(rawIndex) ?? 0
    if (total === 0) continue
    if ((coveredPerToken.get(rawIndex) ?? 0) >= total) continue
    residue.push(rawTokens[rawIndex]!)
  }
  return residue
}

/**
 * True when at least one contained held-title run sits wholly inside a
 * balanced bracket group of the raw run — an amendment parenthetical such as
 * `(Amendment of Equality Act 2010)`. That is the nested-title shape; an
 * unbracketed held title is a separate mention, which is how a conjunction of
 * Acts and an all-caps subject clause stay prose.
 *
 * Depth is read at the run's own text, not at the raw token it arrives in.
 * `(Equality` is a single token, so a token-boundary reading records depth 0
 * and calls the run unbracketed — the defect that routed
 * `X (Held Act YYYY) Act ZZZZ` to the keyword path while the spaced form
 * suppressed. Reading the spans settles both directions: an opener attached to
 * the run's first token counts, and an opener that follows the title text in
 * the same token does not.
 */
function hasBracketedContainedRun(
  core: string,
  containedRuns: readonly (readonly string[])[],
): boolean {
  const normalized = core.normalize('NFKC')
  const pieces = foldQueryPieces(normalized)
  const { depthBefore, balanced } = readBracketStructure(normalized)
  // A malformed bracket cannot be reasoned about, so the run is read as
  // bracketed and the query suppresses rather than serving provisions of an
  // unrelated Act.
  if (!balanced) return true
  for (const match of containedRunMatches(pieces, containedRuns)) {
    const first = pieces[match.start]!
    const last = pieces[match.end - 1]!
    if (
      (depthBefore[first.start] ?? 0) > 0 &&
      (depthBefore[last.end] ?? 0) > 0
    ) {
      return true
    }
  }
  return false
}

/**
 * Directory and structure evidence that an Act-shaped value is a subject
 * query that merely mentions an Act, not a whole-title request.
 *
 * The determiner test this replaces was a lexical blacklist, and the test that
 * followed it still read sentence-initial capitalisation as evidence of the
 * whole query: "Defences under Children Act 1989" was suppressed while its
 * lowercase twin stayed on the keyword path. This test reads the directory and
 * the query's own phrase structure instead.
 *
 * The order is load-bearing. A whole query that is a held title with only the
 * final year changed is a title request whatever its casing, which is the
 * first nested-title case exactly (`Worker Protection (Amendment of Equality
 * Act 2010) Act 2010` for the held `... Act 2023`). Otherwise a held title
 * inside the run is stripped, and the words left over are the outer
 * enactment's own: when those are a title phrase and the held title is
 * bracketed as an amendment parenthetical, the query is a standalone outer
 * title even though it embeds held titles. When the residue is not a title
 * phrase, or the held title is an unbracketed separate mention, the
 * containment is prose evidence, which keeps a conjunction of two Acts (`the
 * Equality Act 2010 and the Human Rights Act 1998`) and every clause naming
 * one on the keyword path. A run with no contained held title is decided by
 * the whole-run phrase test, and a proper suffix that is a phrase still marks
 * a leading clause.
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

  const tokens = actTitleTokens(shape.core)
  if (directory.matchesTitleYearVariant(tokens)) return false

  const contained = directory.containedTitleRuns(tokens)
  const residue = residueTitleTokens(shape.core, contained)
  if (
    isTitlePhrase(residue) &&
    (contained.length === 0 || hasBracketedContainedRun(shape.core, contained))
  ) {
    return false
  }
  if (contained.length > 0) return true

  const run = shape.rawRun.split(/\s+/).filter(Boolean)
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
  /** Frozen snapshot; a caller cannot push, splice or reorder it. */
  byNormalizedTitle(normalized: string): readonly LegislationActDirectoryEntry[]
  /** Frozen snapshot; a caller cannot push, splice or reorder it. */
  byLooseTitle(loose: string): readonly LegislationActDirectoryEntry[]
  /** Frozen snapshot of the frozen entries; mutation throws. */
  allTitles(): readonly LegislationActDirectoryEntry[]
  /**
   * Every stored title that occurs as a shorter contiguous run of `tokens`,
   * each run as a fresh frozen copy. The caller subtracts them to recover the
   * outer words of a nested title, so this never hands out a live internal
   * array.
   */
  containedTitleRuns(tokens: readonly string[]): readonly (readonly string[])[]
  /**
   * True when `tokens` is a stored title's token run with only the final year
   * changed. A year variant of a held title is a title request whatever its
   * casing, so a nested outer title lowercased cannot be mistaken for prose.
   */
  matchesTitleYearVariant(tokens: readonly string[]): boolean
}

const emptyEntries: readonly LegislationActDirectoryEntry[] = Object.freeze([])

function frozenLists(
  source: Map<string, LegislationActDirectoryEntry[]>,
): Map<string, readonly LegislationActDirectoryEntry[]> {
  const frozen = new Map<string, readonly LegislationActDirectoryEntry[]>()
  for (const [key, list] of source) frozen.set(key, Object.freeze([...list]))
  return frozen
}

export function createActDirectory(
  input: LegislationActDirectoryEntry[],
): ActDirectory {
  // Freeze internal copies, not the caller's objects: a lookup result cannot
  // mutate a stored entry, and two callers cannot influence each other.
  const entries: readonly LegislationActDirectoryEntry[] = Object.freeze(
    input.map((entry) => Object.freeze({ ...entry })),
  )
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
  const frozenByTitle = frozenLists(byTitle)
  const frozenByLoose = frozenLists(byLoose)
  return {
    byYearNumber: (year, number) =>
      byKey.get(`ukpga/${year}/${number}`) ?? null,
    byNormalizedTitle: (normalized) =>
      frozenByTitle.get(normalized) ?? emptyEntries,
    byLooseTitle: (loose) => frozenByLoose.get(loose) ?? emptyEntries,
    allTitles: () => entries,
    containedTitleRuns: (tokens) => findContainedRuns(tokens, titleRuns),
    matchesTitleYearVariant: (tokens) => matchesYearVariant(tokens, titleRuns),
  }
}

function matchesYearVariant(
  tokens: readonly string[],
  titleRuns: readonly (readonly string[])[],
): boolean {
  const year = tokens[tokens.length - 1]
  if (tokens.length < 2 || !/^\d{4}$/.test(year ?? '')) return false
  for (const run of titleRuns) {
    if (run.length !== tokens.length) continue
    let differsOnlyByYear = true
    for (let index = 0; index < run.length - 1; index += 1) {
      if (run[index] !== tokens[index]) {
        differsOnlyByYear = false
        break
      }
    }
    const runYear = run[run.length - 1]
    if (
      differsOnlyByYear &&
      runYear !== year &&
      /^\d{4}$/.test(runYear ?? '')
    ) {
      return true
    }
  }
  return false
}

function findContainedRuns(
  tokens: readonly string[],
  titleRuns: readonly (readonly string[])[],
): readonly (readonly string[])[] {
  const found: Array<readonly string[]> = []
  for (const run of titleRuns) {
    if (run.length === 0 || run.length >= tokens.length) continue
    if (containsContiguousRun(tokens, run)) found.push(Object.freeze([...run]))
  }
  return Object.freeze(found)
}

function containsContiguousRun(
  haystack: readonly string[],
  needle: readonly string[],
): boolean {
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
