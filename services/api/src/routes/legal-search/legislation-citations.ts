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
 * True when the text is a whole Act-title request: the word "Act" followed by
 * a four-digit year, with a non-empty title run before it. Section and
 * schedule forms are split before this test, so only the Act remainder
 * reaches it.
 *
 * This is deliberately stricter than the earlier "contains act and ends in a
 * year" gate. A sentence that merely ends in a citation ("defences under the
 * Children Act 1989") carries a determiner inside the title run; a short
 * title is a proper-noun phrase and does not. Rejecting the determiner keeps
 * such sentences on the subject/keyword path instead of suppressing their
 * provisions. A fragment with no title words ("Act 2020") is rejected too.
 */
const titleRunDeterminer = /\b(?:the|a|an)\b/

function looksLikeWholeActTitle(value: string): boolean {
  const normalized = normalizeActTitle(value)
  const match = normalized.match(/^(.*?)\bact\b\s*\d{4}$/)
  if (!match) return false
  const titleRun = (match[1] ?? '').trim()
  if (!/[a-z]/.test(titleRun)) return false
  return !titleRunDeterminer.test(titleRun)
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
}

export function createActDirectory(
  entries: LegislationActDirectoryEntry[],
): ActDirectory {
  const byKey = new Map<string, LegislationActDirectoryEntry>()
  const byTitle = new Map<string, LegislationActDirectoryEntry[]>()
  const byLoose = new Map<string, LegislationActDirectoryEntry[]>()
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
  }
  return {
    byYearNumber: (year, number) =>
      byKey.get(`ukpga/${year}/${number}`) ?? null,
    byNormalizedTitle: (normalized) => byTitle.get(normalized) ?? [],
    byLooseTitle: (loose) => byLoose.get(loose) ?? [],
    allTitles: () => entries,
  }
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
 * unbounded `(…)*` over user input is the ReDoS surface CodeQL flags. */
export function parseSectionLabelPath(sectionText: string): string | null {
  const match = sectionText
    .trim()
    .match(/^(\d+[A-Za-z]?)\s*((?:\([^()]+\)\s*){0,5})$/)
  if (!match) return null
  const parts = [match[1]!]
  for (const group of match[2]!.matchAll(/\(([^()]+)\)/g)) {
    const inner = group[1]!.trim()
    if (!inner) return null
    parts.push(inner)
  }
  return `section/${parts.join('/')}`
}

/** Schedule 2 paragraph 4 (and Sch./para. abbreviations) to schedule/2/paragraph/4.
 * Subsection groups bounded at 5 for the same ReDoS reason as above. */
export function parseScheduleLabelPath(scheduleText: string): string | null {
  const match = scheduleText
    .trim()
    .match(
      /^(?:schedule|sch\.?)\s*(\d+)\s*(?:paragraph|para\.?)\s*(\d+[A-Za-z]?)\s*((?:\([^()]+\)\s*){0,5})$/i,
    )
  if (!match) return null
  const parts = [`schedule/${match[1]}`, `paragraph/${match[2]}`]
  for (const group of match[3]!.matchAll(/\(([^()]+)\)/g)) {
    const inner = group[1]!.trim()
    if (!inner) return null
    parts.push(inner)
  }
  return parts.join('/')
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
    let label = parts[1] ? `Sch. ${parts[1]}` : 'Schedule'
    for (let i = 2; i < parts.length; i += 2) {
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
  return looksLikeWholeActTitle(stripLeadingTitleConnectors(actText))
    ? { kind: 'unresolved_title', recognisedQuery }
    : { kind: 'unrecognised' }
}

interface SplitSectionQuery {
  sectionText: string
  actText: string
}

/** Accepts the Act before or after the section: "Equality Act 2010 s. 40"
 * as well as "s. 40 Equality Act 2010". */
function splitSectionQuery(query: string): SplitSectionQuery | null {
  const sectionFirst = query.match(/^\s*(?:s\.?|section)\s+(.+?)\s+(.+?)\s*$/i)
  if (sectionFirst) {
    // The section token runs to the first boundary the Act remainder can
    // start at: peel a leading section number off, the rest names the Act.
    const inner = sectionFirst[1]!.match(
      /^(\d+[A-Za-z]?(?:\s*\([^()]+\)\s*){0,5})\s*(.*)$/,
    )
    if (inner && inner[2]) {
      return {
        sectionText: inner[1]!,
        actText: `${inner[2]!} ${sectionFirst[2]!}`.trim(),
      }
    }
    return { sectionText: sectionFirst[1]!, actText: sectionFirst[2]! }
  }
  const actFirst = query.match(/^\s*(.+?)\s+(?:s\.?|section)\s+(.+?)\s*$/i)
  if (actFirst) return { sectionText: actFirst[2]!, actText: actFirst[1]! }
  return null
}

function splitScheduleQuery(
  query: string,
): { scheduleText: string; actText: string } | null {
  const match = query.match(
    /^\s*((?:schedule|sch\.?)\s*\d+\s*(?:paragraph|para\.?)\s*\d+[A-Za-z]?(?:\s*\([^()]+\)\s*){0,5})\s+(.+?)\s*$/i,
  )
  if (match) return { scheduleText: match[1]!, actText: match[2]! }
  const trailing = query.match(
    /^\s*(.+?)\s+((?:schedule|sch\.?)\s*\d+\s*(?:paragraph|para\.?)\s*\d+[A-Za-z]?(?:\s*\([^()]+\)\s*){0,5})\s*$/i,
  )
  if (trailing) return { scheduleText: trailing[2]!, actText: trailing[1]! }
  // A bare schedule form names no Act: visible non-resolution, not a guess.
  if (
    /^\s*(?:schedule|sch\.?)\s*\d+\s*(?:paragraph|para\.?)\s*\d+/i.test(query)
  ) {
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
