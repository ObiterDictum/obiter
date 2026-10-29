import { isCanonicalActYear } from '@obiter/contracts'
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

export { createActDirectory } from './legislation-titles'
export type {
  ActDirectory,
  LegislationActDirectoryEntry,
} from './legislation-titles'

interface LegislationProvisionRef extends LegislationActRef {
  labelPath: string
  label: string
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
  | { kind: 'not_held'; identity: string; recognisedQuery: string }
  | { kind: 'unresolved_title'; recognisedQuery: string }
  | { kind: 'unrecognised' }

const actAliases = new Map<string, string>([
  ['hra 1998', 'Human Rights Act 1998'],
])

function parseChapterNumber(query: string): {
  year: number
  number: number
  identity: string
} | null {
  const match = query.match(/^\s*([0-9]{4})\s*,?\s*c\.?\s*([0-9]+)\s*$/i)
  if (!match) return null
  const yearText = match[1]
  const numberText = match[2]
  if (!yearText || !numberText) return null
  if (!isCanonicalActYear(yearText)) return null
  const number = Number(numberText)
  if (!Number.isSafeInteger(number) || number < 1) return null
  return {
    year: Number(yearText),
    number,
    identity: `ukpga/${yearText}/${number}`,
  }
}

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
  const stripped = stripLeadingTitleConnectors(titleText)
  if (!looksLikeWholeActTitle(stripped)) return { kind: 'unrecognised' }
  if (actRemainderIsProse(stripped, directory)) return { kind: 'unrecognised' }
  return { kind: 'unresolved_title', recognisedQuery }
}

interface SplitSectionQuery {
  sectionText: string
  actText: string
}

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
  const scheduleFirst = query.match(
    /^\s*((?:schedule|sch\.?)\s*(?:\d+\s*)?(?:paragraph|para\.?)\s*\d+[A-Za-z]?(?:\s*\([^()]+\)){0,5})\s+([A-Za-z][\s\S]*?)\s*$/i,
  )
  if (scheduleFirst) {
    return { scheduleText: scheduleFirst[1]!, actText: scheduleFirst[2]! }
  }
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
    return {
      kind: 'not_held',
      identity: chapter.identity,
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
    if (!labelPath || !section.actText) return { kind: 'unrecognised' }
    const act = resolveActByName(section.actText, directory, trimmed)
    if (act.kind === 'act') return withProvision(act.act, labelPath, trimmed)
    return act
  }

  return resolveActByName(trimmed, directory, trimmed)
}
