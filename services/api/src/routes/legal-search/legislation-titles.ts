import {
  foldTitlePieces,
  readBracketStructure,
  looseActTitleKey,
  normalizeActTitle,
  trimTitleBoundary,
  type FoldedTitlePiece,
} from './legislation-title-boundary'

export {
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

export function looksLikeWholeActTitle(value: string): boolean {
  const shape = actShape(value)
  return Boolean(shape && /[a-z]/.test(shape.run))
}

function actTitleTokens(value: string): string[] {
  return normalizeActTitle(value).split(' ').filter(Boolean)
}

function isTitlePhrase(tokens: readonly string[]): boolean {
  let hasName = false
  let endsWithJoiningWord = false
  for (const token of tokens) {
    if (/[A-Z]/.test(token)) {
      hasName = true
      endsWithJoiningWord = false
      continue
    }
    if (/\d/.test(token)) {
      endsWithJoiningWord = false
      continue
    }
    const folded = normalizeActTitle(token)
    if (!folded) continue
    if (titleJoiningWordSet.has(folded)) {
      endsWithJoiningWord = true
      continue
    }
    return false
  }
  return hasName && !endsWithJoiningWord
}

function containedRunMatches(
  pieces: readonly FoldedTitlePiece[],
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

function residueTitleTokens(
  core: string,
  containedRuns: readonly (readonly string[])[],
): string[] {
  const normalized = core.normalize('NFKC')
  const pieces = foldTitlePieces(normalized)
  const covered: boolean[] = Array.from({ length: pieces.length }, () => false)
  for (const match of containedRunMatches(pieces, containedRuns)) {
    for (let index = match.start; index < match.end; index += 1) {
      covered[index] = true
    }
  }
  const residue: string[] = []
  for (let index = 0; index < pieces.length; index += 1) {
    if (covered[index]) continue
    const piece = pieces[index]!
    residue.push(normalized.slice(piece.start, piece.end))
  }
  return residue
}

function hasBracketedContainedRun(
  core: string,
  containedRuns: readonly (readonly string[])[],
): boolean {
  const normalized = core.normalize('NFKC')
  const pieces = foldTitlePieces(normalized)
  const { depthBefore, balanced } = readBracketStructure(normalized)
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
  byNormalizedTitle(normalized: string): readonly LegislationActDirectoryEntry[]
  byLooseTitle(loose: string): readonly LegislationActDirectoryEntry[]
  allTitles(): readonly LegislationActDirectoryEntry[]
  containedTitleRuns(tokens: readonly string[]): readonly (readonly string[])[]
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
