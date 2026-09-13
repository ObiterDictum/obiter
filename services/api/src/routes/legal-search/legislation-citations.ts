/**
 * Pure legislation citation recognition for Stage 1 (UK Public General Acts).
 *
 * Resolves, in order: chapter numbers (`1998 c. 42`), short titles
 * (`Human Rights Act 1998`), curated aliases (`HRA 1998`), and section forms
 * (`s 6 HRA 1998`, `section 6 Human Rights Act 1998`,
 * `Schedule 2 paragraph 4`, `s 13(2)(a)` with the Act named in the query).
 * Secondary legislation is out of scope and never matches here.
 *
 * Ambiguity never resolves silently: a query naming an Act two stored titles
 * could satisfy returns `ambiguous` with the candidates, and a section form
 * without an identifiable Act returns `unrecognised`. Callers turn both into
 * visible states, never a guessed winner.
 *
 * No network, no storage. Callers supply the act directory from Postgres.
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

export interface LegislationProvisionRef extends LegislationActRef {
  labelPath: string
  label: string
  /** Full provision identity, e.g. ukpga/2010/15/section/40. */
  provisionId: string
}

export type LegislationCitationOutcome =
  | { kind: 'act'; act: LegislationActRef; recognisedQuery: string }
  | {
      kind: 'provision'
      provision: LegislationProvisionRef
      recognisedQuery: string
    }
  | { kind: 'ambiguous'; candidates: LegislationActRef[]; reason: string }
  // A well-formed chapter citation for a year and number the corpus does not
  // hold. This is authoritative: the year and number are the canonical
  // identity, so an absent chapter proves the Act is absent. A failed *title*
  // lookup does not (see `unresolved_title`).
  | { kind: 'not_held'; recognisedQuery: string }
  // The query is a whole Act-title request, but the directory cannot resolve
  // it. The local directory is partial and title resolution is imperfect, so
  // this state suppresses unrelated keyword provisions without claiming the
  // Act is absent.
  | { kind: 'unresolved_title'; recognisedQuery: string }
  | { kind: 'unrecognised' }

/** Curated aliases only: an alias maps one surface form to one Act, and any
 * form that could name two Acts stays out of this table on purpose. A Map, not
 * an object literal: `actAliases['constructor']` on an object resolves to
 * `Object` and truthy, which then throws in `normalizeActTitle` for a bare
 * query. */
const actAliases = new Map<string, string>([
  ['hra 1998', 'Human Rights Act 1998'],
])

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
  const match = value.match(/^(.*?)\bact\b\s*\d{4}\s*$/i)
  if (!match) return null
  const rawRun = (match[1] ?? '').trim()
  return { run: normalizeActTitle(rawRun), rawRun }
}

/**
 * True when the text is an Act-shaped request with a non-empty title run.
 * A bare "Act <year>" has no title words, so it cannot support a title
 * claim; a phrase with at least one letter before "Act" can.
 */
function looksLikeWholeActTitle(value: string): boolean {
  const shape = actShape(value)
  return Boolean(shape && /[a-z]/.test(shape.run))
}

function actTitleTokens(value: string): string[] {
  return normalizeActTitle(value).split(' ').filter(Boolean)
}

/**
 * Directory and structure evidence that an Act-shaped value is a subject
 * query that merely mentions an Act, not a whole-title request.
 *
 * The determiner test this replaces was a lexical blacklist: it caught
 * "defences under the Children Act 1989" but not "duties under Equality Act
 * 2010", and it could only ever catch the determiners someone thought of.
 * This test reads the directory and the query's own shape instead:
 *
 * - A held Act title inside a longer query is proof the query names
 *   something more than that title. The extra text is the query, so the
 *   whole query stays a subject search. Nothing is discarded.
 * - An Act short title is a proper-noun phrase. A lowercase run before the
 *   first capitalised name is prose ("changes introduced by Companies Act
 *   2006", "defences under Children Act 1989"); the capitalised part begins
 *   the title.
 *
 * An underspecified fragment is handled before this: `looksLikeWholeActTitle`
 * rejects a run with no words, so "Act 2020" never reaches a claim.
 */
function actRemainderIsProse(value: string, directory: ActDirectory): boolean {
  const shape = actShape(value)
  if (!shape) return true
  if (directory.containsTitleRun(actTitleTokens(value))) return true

  const rawTokens = shape.rawRun.split(/\s+/).filter(Boolean)
  const firstCapitalised = rawTokens.findIndex((token) => /^[A-Z]/.test(token))
  return firstCapitalised > 0
}

/**
 * Leading function words a citation remainder can carry before the title
 * ("section 2 of the Human Rights Act 1998"). Stripped before matching so the
 * title itself is compared, never the surrounding connector.
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

function toActRef(entry: LegislationActDirectoryEntry): LegislationActRef {
  return {
    actType: entry.actType,
    year: entry.year,
    number: entry.number,
    identity: entry.identity,
    title: entry.title,
  }
}

function parseChapterNumber(
  query: string,
): { year: number; number: number } | null {
  const match = query.match(/^\s*(\d{4})\s*,?\s*c\.?\s*(\d+)\s*$/i)
  if (!match) return null
  return { year: Number(match[1]), number: Number(match[2]) }
}

/** s. 13(2)(a) to section/13/2/a; 6 to section/6. Null when not a section form.
 * Subsection groups are bounded at 5: real citations nest far less, and an
 * unbounded `(…)*` over user input is the ReDoS surface CodeQL flags. A group
 * may be spaced (`20 (3)`) or spelled (`20 subsection 3`); both name the same
 * subsection, and the bounded group count is not weakened by either. */
export function parseSectionLabelPath(sectionText: string): string | null {
  const match = sectionText
    .trim()
    .match(
      /^(\d+[A-Za-z]?)((?:\s*(?:\([^()]+\)|(?:subsection|sub-section|subs\.?)\s*\d+[A-Za-z]?)){0,5})$/i,
    )
  if (!match) return null
  const parts = [match[1]!]
  const groups = match[2]!.matchAll(
    /\(\s*([^()]+?)\s*\)|(?:subsection|sub-section|subs\.?)\s*(\d+[A-Za-z]?)/gi,
  )
  for (const group of groups) {
    const inner = (group[1] ?? group[2] ?? '').trim()
    if (!inner) return null
    parts.push(inner)
  }
  return `section/${parts.join('/')}`
}

/** A schedule citation to its stored label path. Accepts schedule-first
 * (`Schedule 2 paragraph 4`, `Sch. para. 2`) and paragraph-first
 * (`para. 2 Sch. 1`) order, with the same 5-group bound as sections. An
 * unnumbered schedule produces `schedule/paragraph/4`; whether the Act uses
 * that shape is the store's decision, not this parser's. */
const scheduleGroups = String.raw`((?:\s*\([^()]+\)){0,5})`

export function parseScheduleLabelPath(scheduleText: string): string | null {
  const text = scheduleText.trim()
  const numbered = text.match(
    new RegExp(
      String.raw`^(?:schedule|sch\.?)\s*(\d+)\s*(?:paragraph|para\.?)\s*(\d+[A-Za-z]?)${scheduleGroups}$`,
      'i',
    ),
  )
  if (numbered) {
    const parts = [`schedule/${numbered[1]}`, `paragraph/${numbered[2]}`]
    return appendScheduleGroups(parts, numbered[3]!) ? parts.join('/') : null
  }
  const unnumbered = text.match(
    new RegExp(
      String.raw`^(?:schedule|sch\.?)\s*(?:paragraph|para\.?)\s*(\d+[A-Za-z]?)${scheduleGroups}$`,
      'i',
    ),
  )
  if (unnumbered) {
    const parts = ['schedule', `paragraph/${unnumbered[1]}`]
    return appendScheduleGroups(parts, unnumbered[2]!) ? parts.join('/') : null
  }
  const paragraphFirst = text.match(
    new RegExp(
      String.raw`^(?:paragraph|para\.?)\s*(\d+[A-Za-z]?)${scheduleGroups}\s*(?:of\s*)?(?:schedule|sch\.?)\s*(\d+)$`,
      'i',
    ),
  )
  if (paragraphFirst) {
    const parts = [
      `schedule/${paragraphFirst[3]}`,
      `paragraph/${paragraphFirst[1]}`,
    ]
    return appendScheduleGroups(parts, paragraphFirst[2]!)
      ? parts.join('/')
      : null
  }
  return null
}

function appendScheduleGroups(parts: string[], groups: string): boolean {
  for (const group of groups.matchAll(/\(([^()]+)\)/g)) {
    const inner = group[1]!.trim()
    if (!inner) return false
    parts.push(inner)
  }
  return true
}

export function formatProvisionDisplayLabel(labelPath: string): string {
  // Mirrors formatProvisionLabel in the ingestor's legislation-clml.ts (kept
  // separate: services must not import each other).
  const parts = labelPath.split('/')
  if (parts[0] === 'section') {
    const nums = parts.slice(1)
    if (nums.length === 0) return 'section'
    return `s. ${nums[0]}${nums
      .slice(1)
      .map((n) => `(${n})`)
      .join('')}`
  }
  if (parts[0] === 'schedule') {
    // An unnumbered single schedule stores its paragraphs directly under
    // `schedule`, so parts[1] is `paragraph`, not a schedule number.
    const numbered = /^\d+[A-Za-z]?$/.test(parts[1] ?? '')
    let label = numbered ? `Sch. ${parts[1]}` : 'Sch.'
    for (let i = numbered ? 2 : 1; i < parts.length; i += 2) {
      const kind = parts[i]
      const num = parts[i + 1]
      if (kind === 'paragraph') label += num ? ` para. ${num}` : ' para.'
      else if (kind === 'part') label += num ? ` Pt. ${num}` : ' Pt.'
      else if (num !== undefined) label += ` ${kind} ${num}`
      else if (kind) label += ` ${kind}`
    }
    return label
  }
  return labelPath
}

/** The citation form of a stored schedule label path, so guidance the product
 * emits is a citation the parser accepts. A numbered path names its own
 * schedule. An unnumbered `schedule/paragraph/N` path is the single-schedule
 * shape, which the store only reaches on an Act that holds a numbered
 * Schedule 1, so the example names Schedule 1. Null for a path that is not a
 * schedule paragraph. */
export function formatScheduleCitation(labelPath: string): string | null {
  const parts = labelPath.split('/')
  const numbered = /^\d+$/.test(parts[1] ?? '')
  const paragraphAt = numbered ? 2 : 1
  if (parts[paragraphAt] !== 'paragraph') return null
  const paragraphNumber = parts[paragraphAt + 1] ?? ''
  const groups = parts.slice(paragraphAt + 2)
  if (!/^\d+[A-Za-z]?$/.test(paragraphNumber)) return null
  if (!groups.every((group) => /^[A-Za-z0-9]+$/.test(group))) return null
  return (
    `Schedule ${numbered ? parts[1] : '1'} paragraph ${paragraphNumber}` +
    groups.map((group) => `(${group})`).join('')
  )
}

function expandAlias(actText: string): string {
  const normalized = normalizeActTitle(actText)
  const aliased = actAliases.get(normalized)
  if (aliased) return normalizeActTitle(aliased)
  return normalized
}

function resolveActByName(
  actText: string,
  directory: ActDirectory,
  recognisedQuery: string,
): LegislationCitationOutcome {
  const matches = new Map<string, LegislationActDirectoryEntry>()
  for (const value of [actText, stripLeadingTitleConnectors(actText)]) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const normalized = expandAlias(trimmed)
    for (const entry of directory.byNormalizedTitle(normalized)) {
      matches.set(entry.identity, entry)
    }
    for (const entry of directory.byLooseTitle(
      normalized.replace(/[^a-z0-9]/g, ''),
    )) {
      matches.set(entry.identity, entry)
    }
  }
  if (matches.size === 1) {
    return {
      kind: 'act',
      act: toActRef([...matches.values()][0]!),
      recognisedQuery,
    }
  }
  if (matches.size > 1) {
    return {
      kind: 'ambiguous',
      candidates: [...matches.values()].map(toActRef),
      reason: `“${actText.trim()}” names more than one stored Act.`,
    }
  }
  // A title-shaped request the directory cannot resolve is not proof the Act
  // is absent: the directory is partial and the fold is imperfect. Suppress
  // unrelated keyword provisions, but say only that no exact title matched.
  // Directory and structure evidence that the query is really a subject
  // phrase keeps it on the keyword path instead.
  const stripped = stripLeadingTitleConnectors(actText)
  if (!looksLikeWholeActTitle(stripped)) return { kind: 'unrecognised' }
  if (actRemainderIsProse(stripped, directory)) return { kind: 'unrecognised' }
  return { kind: 'unresolved_title', recognisedQuery }
}

interface SplitSectionQuery {
  sectionText: string
  actText: string
}

/** Accepts the Act before or after the section: "Equality Act 2010 s. 40"
 * as well as "s. 40 Equality Act 2010". The section token absorbs spaced
 * parentheses (`s. 20 (3)`) and the spelled `subsection N` form, so the Act
 * remainder starts at the first word after it and no citation text leaks
 * into title resolution. */
function splitSectionQuery(query: string): SplitSectionQuery | null {
  const sectionToken = String.raw`\d+[A-Za-z]?(?:\s*(?:\([^()]+\)|(?:subsection|sub-section|subs\.?)\s*\d+[A-Za-z]?)){0,5}`
  const sectionFirst = query.match(
    new RegExp(
      String.raw`^\s*(?:s\.?|section)\s+(${sectionToken})\s+([A-Za-z][\s\S]*?)\s*$`,
      'i',
    ),
  )
  if (sectionFirst) {
    return { sectionText: sectionFirst[1]!, actText: sectionFirst[2]! }
  }
  // A section form with no Act remainder names no Act: visible
  // non-resolution, never a guess. A malformed section token lands here too,
  // so `s. 20 () X` cannot smuggle the section text into the Act.
  const afterSection = query.replace(/^\s*(?:s\.?|section)\s+/i, '')
  if (afterSection !== query) return { sectionText: afterSection, actText: '' }

  const actFirst = query.match(
    new RegExp(
      String.raw`^\s*([A-Za-z][\s\S]*?)\s+(?:s\.?|section)\s+(${sectionToken})\s*$`,
      'i',
    ),
  )
  if (actFirst) return { sectionText: actFirst[2]!, actText: actFirst[1]! }
  return null
}

function splitScheduleQuery(
  query: string,
): { scheduleText: string; actText: string } | null {
  // Schedule-first: "Schedule 1 paragraph 2 <Act>", "Sch. para. 2 <Act>".
  const scheduleFirst = query.match(
    /^\s*((?:schedule|sch\.?)\s*(?:\d+\s*)?(?:paragraph|para\.?)\s*\d+[A-Za-z]?(?:\s*\([^()]+\)){0,5})\s+([A-Za-z][\s\S]*?)\s*$/i,
  )
  if (scheduleFirst) {
    return { scheduleText: scheduleFirst[1]!, actText: scheduleFirst[2]! }
  }
  // Paragraph-first: "paragraph 2 Schedule 1 <Act>", "para. 2 Sch. 1 <Act>".
  const paragraphFirst = query.match(
    /^\s*((?:paragraph|para\.?)\s*\d+[A-Za-z]?(?:\s*\([^()]+\)){0,5}\s*(?:of\s*)?(?:schedule|sch\.?)\s*\d+)\s+([A-Za-z][\s\S]*?)\s*$/i,
  )
  if (paragraphFirst) {
    return { scheduleText: paragraphFirst[1]!, actText: paragraphFirst[2]! }
  }
  const trailing = query.match(
    /^\s*([A-Za-z][\s\S]*?)\s+((?:schedule|sch\.?)\s*\d+\s*(?:paragraph|para\.?)\s*\d+[A-Za-z]?(?:\s*\([^()]+\)){0,5})\s*$/i,
  )
  if (trailing) return { scheduleText: trailing[2]!, actText: trailing[1]! }
  // A bare schedule form names no Act: visible non-resolution, not a guess.
  if (parseScheduleLabelPath(query) !== null) {
    return { scheduleText: query.trim(), actText: '' }
  }
  return null
}

function withProvision(
  act: LegislationActRef,
  labelPath: string,
  recognisedQuery: string,
): LegislationCitationOutcome {
  return {
    kind: 'provision',
    provision: {
      ...act,
      labelPath,
      label: formatProvisionDisplayLabel(labelPath),
      provisionId: `${act.identity}/${labelPath}`,
    },
    recognisedQuery,
  }
}

/**
 * Classify a raw query against the stored Act directory. Returns the
 * recognised surface form alongside every hit so served labels and the
 * citation honesty fields read the same value.
 */
export function classifyLegislationCitation(
  query: string,
  directory: ActDirectory,
): LegislationCitationOutcome {
  const trimmed = query.trim()
  if (!trimmed) return { kind: 'unrecognised' }

  const chapter = parseChapterNumber(trimmed)
  if (chapter) {
    const found = directory.byYearNumber(chapter.year, chapter.number)
    if (found)
      return { kind: 'act', act: toActRef(found), recognisedQuery: trimmed }
    // A chapter number the directory does not hold is a recognised citation
    // with no answer in the corpus, not a phrase to keyword-search.
    return { kind: 'not_held', recognisedQuery: trimmed }
  }

  const schedule = splitScheduleQuery(trimmed)
  if (schedule) {
    const labelPath = parseScheduleLabelPath(schedule.scheduleText)
    if (!labelPath || !schedule.actText) return { kind: 'unrecognised' }
    const act = resolveActByName(schedule.actText, directory, trimmed)
    if (act.kind === 'act') return withProvision(act.act, labelPath, trimmed)
    return act
  }

  const section = splitSectionQuery(trimmed)
  if (section) {
    const labelPath = parseSectionLabelPath(section.sectionText)
    // A section number that is really an Act remainder (no Act part, or a
    // non-section token) is not a legislation citation at all.
    if (!labelPath || !section.actText) return { kind: 'unrecognised' }
    const act = resolveActByName(section.actText, directory, trimmed)
    if (act.kind === 'act') return withProvision(act.act, labelPath, trimmed)
    return act
  }

  return resolveActByName(trimmed, directory, trimmed)
}
