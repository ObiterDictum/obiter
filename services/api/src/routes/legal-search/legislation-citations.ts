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
 * Title folding, the stored-title directory and the whole-title-versus-prose
 * decision live in `legislation-titles.ts`; this module owns citation parsing
 * and the order resolution runs in.
 *
 * No network, no storage. Callers supply the act directory from Postgres.
 */

import {
  actRemainderIsProse,
  looksLikeWholeActTitle,
  normalizeActTitle,
  stripLeadingTitleConnectors,
  toActRef,
  trimTitleBoundary,
  type ActDirectory,
  type LegislationActDirectoryEntry,
  type LegislationActRef,
} from './legislation-titles'

export {
  createActDirectory,
  looseActTitleKey,
  normalizeActTitle,
  stripLeadingTitleConnectors,
} from './legislation-titles'
export type {
  ActDirectory,
  LegislationActDirectoryEntry,
  LegislationActRef,
} from './legislation-titles'

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
  // identity, so an absent chapter proves the Act is absent. `identity` is that
  // canonical identity, so a caller that needs one (verification's resolution
  // step) does not have to re-parse the citation or invent it. A failed *title*
  // lookup does not prove absence (see `unresolved_title`).
  | { kind: 'not_held'; identity: string; recognisedQuery: string }
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
  // `trimTitleBoundary` first: a real request arrives as a sentence, wrapped in
  // quotes, or carrying the terminal status annotation, and all three name the
  // same Act. Exact and relaxed directory resolution runs on that core before
  // any prose claim.
  const titleText = trimTitleBoundary(actText)
  const matches = new Map<string, LegislationActDirectoryEntry>()
  for (const value of [titleText, stripLeadingTitleConnectors(titleText)]) {
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
  const stripped = stripLeadingTitleConnectors(titleText)
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
    // with no answer in the corpus, not a phrase to keyword-search. The
    // identity is derived here, where the chapter form is parsed, so no caller
    // re-derives it from the digits.
    return {
      kind: 'not_held',
      identity: `ukpga/${chapter.year}/${chapter.number}`,
      recognisedQuery: trimmed,
    }
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
