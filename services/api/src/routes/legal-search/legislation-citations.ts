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
  | { kind: 'unrecognised' }

/** Curated aliases only: an alias maps one surface form to one Act, and any
 * form that could name two Acts stays out of this table on purpose. A Map, not
 * an object literal: `actAliases['constructor']` on an object resolves to
 * `Object` and truthy, which then throws in `normalizeActTitle` for a bare
 * query. */
const actAliases = new Map<string, string>([
  ['hra 1998', 'Human Rights Act 1998'],
])

export function normalizeActTitle(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[.,;:'"()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface ActDirectory {
  byYearNumber(
    year: number,
    number: number,
  ): LegislationActDirectoryEntry | null
  byNormalizedTitle(normalized: string): LegislationActDirectoryEntry[]
  allTitles(): LegislationActDirectoryEntry[]
}

export function createActDirectory(
  entries: LegislationActDirectoryEntry[],
): ActDirectory {
  const byKey = new Map<string, LegislationActDirectoryEntry>()
  const byTitle = new Map<string, LegislationActDirectoryEntry[]>()
  for (const entry of entries) {
    byKey.set(`${entry.actType}/${entry.year}/${entry.number}`, entry)
    const normalized = normalizeActTitle(entry.title)
    const list = byTitle.get(normalized) ?? []
    list.push(entry)
    byTitle.set(normalized, list)
  }
  return {
    byYearNumber: (year, number) =>
      byKey.get(`ukpga/${year}/${number}`) ?? null,
    byNormalizedTitle: (normalized) => byTitle.get(normalized) ?? [],
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
  const normalized = expandAlias(actText)
  const exact = directory.byNormalizedTitle(normalized)
  if (exact.length === 1) {
    return { kind: 'act', act: toActRef(exact[0]!), recognisedQuery }
  }
  if (exact.length > 1) {
    return {
      kind: 'ambiguous',
      candidates: exact.map(toActRef),
      reason: `“${actText.trim()}” names more than one stored Act.`,
    }
  }
  // Suffix match so "section 6 Human Rights Act 1998" finds its Act when the
  // caller passes the whole remainder: longest stored title that ends the
  // query remainder wins, and only when exactly one title of that length
  // matches. A shorter rival that is also a suffix means genuine ambiguity.
  const suffixes = directory
    .allTitles()
    .filter((entry) => {
      const title = normalizeActTitle(entry.title)
      return normalized === title || normalized.endsWith(` ${title}`)
    })
    .sort((a, b) => b.title.length - a.title.length)
  if (suffixes.length === 0) return { kind: 'unrecognised' }
  const longest = normalizeActTitle(suffixes[0]!.title)
  const rivals = suffixes.filter(
    (entry) => normalizeActTitle(entry.title) === longest,
  )
  if (rivals.length > 1) {
    return {
      kind: 'ambiguous',
      candidates: rivals.map(toActRef),
      reason: `“${actText.trim()}” names more than one stored Act.`,
    }
  }
  return { kind: 'act', act: toActRef(suffixes[0]!), recognisedQuery }
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
    return { kind: 'unrecognised' }
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
