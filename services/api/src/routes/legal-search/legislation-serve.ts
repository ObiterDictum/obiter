import type { Pool } from 'pg'
import {
  searchLegislation,
  type AppliedLegislationSearchParameters,
} from '@obiter/search-client'
import {
  classifyLegislationCitation,
  createActDirectory,
  formatScheduleCitation,
  type LegislationActDirectoryEntry,
} from './legislation-citations'
import {
  createCanonicalProvisionPath,
  type LegislationScheduleGuidance,
} from '@obiter/contracts'
import {
  getLegislationDocument,
  getLegislationProvision,
  legislationProvisionPathExists,
  listLegislationActs,
  provisionTextServable,
  type StoredLegislationProvision,
} from './legislation-store'
import {
  amendedProvisionNotice,
  type LegalFetchResultGroup,
  type LegislationFetchHit,
} from './response-utils'

/**
 * Legislation half of POST /api/search/fetch. Reads exact answers from
 * Postgres (the record) and keyword candidates from the derived
 * legislation_provisions index; a dead index or store never fails the
 * judgment half, it just serves no legislation group. The two groups are
 * federated by the caller: judgment flat hits first, this group after,
 * never interleaved.
 */

export interface LegislationServeDeps {
  pool: Pick<Pool, 'query'>
  searchClient: Parameters<typeof searchLegislation>[0]
  indexName: string
  keywordLimit?: number
}

export interface LegislationFetchResult {
  groups: LegalFetchResultGroup[]
  citationRecognised: boolean
  citationHeldExact: boolean
  /** Authoritative not-held: a chapter citation or provision the store proves
   * is absent. Never set from a failed title lookup alone. */
  recognisedNotHeld: boolean
  /** The query looked like a whole Act title but the directory could not
   * resolve it. Suppresses keyword provisions without claiming the Act is
   * absent. */
  titleUnresolved: boolean
  /** More than one stored Act satisfies the query. Never a not-held verdict. */
  ambiguous: boolean
  /** A held Act whose citation names a schedule paragraph but no schedule
   * number. The store cannot resolve it without guessing, so this carries the
   * parser-compatible example (built from the citation's own label path) and
   * the Act context needed to resubmit it. Null otherwise. */
  scheduleUnderspecified: LegislationScheduleGuidance | null
  note: string | null
  searched: boolean
  /**
   * Search-time parameters the legislation keyword search sent to the engine.
   * Null when no keyword search ran: an exact Act or provision answer, an
   * ambiguous query, a store failure, or an empty query. The serve layer
   * reports what it applied so a caller never has to assert its own
   * configured constants for conditions it did not observe.
   */
  keywordSearchParameters: AppliedLegislationSearchParameters | null
}

// Bounds every stored lookup, mirroring the judgment half: a slow store
// fails this half open (no group) rather than holding the route.
const storedLegislationTimeoutMs = 2000

export async function withStoredTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Legislation store timed out.')),
          storedLegislationTimeoutMs,
        )
        timer.unref?.()
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

const emptyResult: LegislationFetchResult = {
  groups: [],
  citationRecognised: false,
  citationHeldExact: false,
  recognisedNotHeld: false,
  titleUnresolved: false,
  ambiguous: false,
  scheduleUnderspecified: null,
  note: null,
  searched: false,
  keywordSearchParameters: null,
}

function excerpt(text: string, maxLength = 240): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length <= maxLength
    ? collapsed
    : `${collapsed.slice(0, maxLength).trim()}...`
}

export function officialProvisionUrl(
  documentIdentity: string,
  labelPath: string,
): string {
  return `https://www.legislation.gov.uk/${documentIdentity}/${labelPath}`
}

type StoredProvisionResolution =
  | { status: 'held'; provision: StoredLegislationProvision }
  | { status: 'missing'; labelPath: string }
  | { status: 'underspecified' }

/**
 * Resolve a citation's label path against the store, tolerating the
 * single-schedule storage shape. Some Acts leave their only schedule
 * unnumbered, so its paragraphs store at `schedule/paragraph/N` while a
 * citation says "Schedule 1 paragraph N". The numbered path wins when it
 * exists; the unnumbered fallback applies only when the citation names
 * Schedule 1 and the Act has no numbered Schedule 1. Schedule 2 is never
 * mapped onto an unnumbered schedule, and a paragraph citation with no
 * schedule number on a numbered-schedule Act is non-resolution, not a
 * not-held claim.
 */
async function resolveStoredProvision(
  pool: LegislationServeDeps['pool'],
  identity: string,
  labelPath: string,
): Promise<StoredProvisionResolution> {
  const exact = await withStoredTimeout(
    getLegislationProvision(pool, `${identity}/${labelPath}`),
  )
  if (exact) return { status: 'held', provision: exact }
  if (!labelPath.startsWith('schedule/')) {
    return { status: 'missing', labelPath }
  }
  const numbered = labelPath.match(/^schedule\/(\d+)\//)
  if (!numbered) {
    // An unnumbered citation only resolves on the exact path above, which
    // exists for the single-schedule shape. On an Act with numbered
    // schedules the schedule number is missing: say so rather than guess.
    const hasNumberedSchedule = await withStoredTimeout(
      legislationProvisionPathExists(pool, identity, 'schedule/1'),
    )
    return hasNumberedSchedule
      ? { status: 'underspecified' }
      : { status: 'missing', labelPath }
  }
  const scheduleNumber = numbered[1]!
  const hasNumberedSchedule = await withStoredTimeout(
    legislationProvisionPathExists(
      pool,
      identity,
      `schedule/${scheduleNumber}`,
    ),
  )
  if (scheduleNumber !== '1' || hasNumberedSchedule) {
    return { status: 'missing', labelPath }
  }
  const alternateLabelPath = labelPath.replace(/^schedule\/1\//, 'schedule/')
  const alternate = await withStoredTimeout(
    getLegislationProvision(pool, `${identity}/${alternateLabelPath}`),
  )
  return alternate
    ? { status: 'held', provision: alternate }
    : { status: 'missing', labelPath: alternateLabelPath }
}

function currentProvisionHit(
  provision: {
    id: string
    documentIdentity: string
    labelPath: string
    label: string
    extent: string
    text: string
    title: string
    year: number
    sourceUrl: string
  },
  retrievalPath: LegislationFetchHit['retrievalPath'],
  retrievalRank: number,
): LegislationFetchHit {
  return {
    id: provision.id,
    resultGroup: 'legislation',
    legislationStatus: 'current',
    title: provision.title,
    year: provision.year,
    provisionLabel: provision.label,
    labelPath: provision.labelPath,
    documentIdentity: provision.documentIdentity,
    extent: provision.extent,
    canonicalUrl: createCanonicalProvisionPath(
      provision.documentIdentity,
      provision.labelPath,
    ),
    text: provision.text.slice(0, 4000),
    snippets: [{ text: excerpt(provision.text) }],
    officialUrl: officialProvisionUrl(
      provision.documentIdentity,
      provision.labelPath,
    ),
    sourceUrl: provision.sourceUrl,
    citationMatch: 'exact',
    retrievalPath,
    retrievalRank,
  }
}

function amendedProvisionHit(
  provision: {
    id: string
    documentIdentity: string
    labelPath: string
    label: string
    extent: string
    title: string
    year: number
    sourceUrl: string
  },
  retrievalPath: LegislationFetchHit['retrievalPath'],
  retrievalRank: number,
): LegislationFetchHit {
  const officialUrl = officialProvisionUrl(
    provision.documentIdentity,
    provision.labelPath,
  )
  return {
    id: provision.id,
    resultGroup: 'legislation',
    legislationStatus: 'amended_not_held',
    title: provision.title,
    year: provision.year,
    provisionLabel: provision.label,
    labelPath: provision.labelPath,
    documentIdentity: provision.documentIdentity,
    extent: provision.extent,
    canonicalUrl: createCanonicalProvisionPath(
      provision.documentIdentity,
      provision.labelPath,
    ),
    officialUrl,
    sourceUrl: provision.sourceUrl,
    notice: amendedProvisionNotice(officialUrl),
    citationMatch: 'exact',
    retrievalPath,
    retrievalRank,
  }
}

export async function resolveLegislationFetch(
  deps: LegislationServeDeps,
  query: string,
): Promise<LegislationFetchResult> {
  if (!query.trim()) return emptyResult
  let acts: LegislationActDirectoryEntry[]
  try {
    acts = await withStoredTimeout(listLegislationActs(deps.pool))
  } catch {
    return { ...emptyResult, note: 'Legislation store unavailable.' }
  }
  if (acts.length === 0) return emptyResult
  const directory = createActDirectory(acts)
  const outcome = classifyLegislationCitation(query, directory)

  if (outcome.kind === 'ambiguous') {
    const names = outcome.candidates
      .map((candidate) => candidate.title)
      .join('; ')
    return {
      ...emptyResult,
      searched: true,
      citationRecognised: true,
      ambiguous: true,
      note: `${outcome.reason} Candidates: ${names}`,
    }
  }

  if (outcome.kind === 'unresolved_title') {
    // A whole Act-title request the directory cannot resolve. The local
    // directory is partial and the fold is imperfect, so this suppression
    // says only what is known: no exact title key matched. It never claims
    // the Act itself is absent.
    return {
      ...emptyResult,
      searched: true,
      citationRecognised: true,
      titleUnresolved: true,
      note: `No exact legislation title match was found for "${outcome.recognisedQuery}".`,
    }
  }

  if (outcome.kind === 'not_held') {
    // A recognised Act or chapter citation the corpus does not hold: the
    // legislation mirror of the judgment honesty gate. No keyword search runs,
    // because a provision that merely shares words with the title is not an
    // answer to "show me that Act". The note names what was asked for, so the
    // page reads as not held rather than not searched.
    return {
      ...emptyResult,
      searched: true,
      citationRecognised: true,
      recognisedNotHeld: true,
      note: `${outcome.recognisedQuery} is not held.`,
    }
  }

  if (outcome.kind === 'provision') {
    let resolution: StoredProvisionResolution
    try {
      resolution = await resolveStoredProvision(
        deps.pool,
        outcome.provision.identity,
        outcome.provision.labelPath,
      )
    } catch {
      return {
        ...emptyResult,
        searched: true,
        note: 'Legislation store unavailable.',
      }
    }
    if (resolution.status === 'underspecified') {
      // A held Act with a paragraph citation that names no schedule: the
      // citation is underspecified, not the provision absent. Guessing
      // Schedule 1 would be a wrong-Act-class mistake at provision level.
      // The example and the Act are structured data so the client never has
      // to parse the note to resubmit a citation the parser accepts.
      const example = formatScheduleCitation(outcome.provision.labelPath)
      return {
        ...emptyResult,
        searched: true,
        citationRecognised: true,
        scheduleUnderspecified: {
          example,
          actTitle: outcome.provision.title,
        },
        note:
          `${outcome.provision.label} of ${outcome.provision.title} names no ` +
          `schedule. Name the schedule to resolve it` +
          (example ? ` (for example "${example}").` : '.'),
      }
    }
    if (resolution.status === 'missing') {
      return {
        ...emptyResult,
        searched: true,
        citationRecognised: true,
        recognisedNotHeld: true,
        note:
          `${outcome.provision.label} of ${outcome.provision.title} is not held ` +
          `(official text: ${officialProvisionUrl(outcome.provision.identity, resolution.labelPath)}).`,
      }
    }
    const provision = resolution.provision
    // Fail-closed: only an explicit false carrying a check timestamp
    // serves text. Undefined (a row the validator would now drop, or a
    // store row predating the flag) and unchecked legacy rows (a
    // default-false flag with a null timestamp) both withhold.
    const hit = provisionTextServable(
      provision.hasUnappliedEffects,
      provision.effectsCheckedAt,
    )
      ? currentProvisionHit(provision, 'stored_exact_lookup', 1)
      : amendedProvisionHit(provision, 'stored_exact_lookup', 1)
    return {
      groups: [{ key: 'legislation', label: 'Legislation', hits: [hit] }],
      citationRecognised: true,
      citationHeldExact: true,
      recognisedNotHeld: false,
      titleUnresolved: false,
      ambiguous: false,
      scheduleUnderspecified: null,
      note: null,
      searched: true,
      keywordSearchParameters: null,
    }
  }

  if (outcome.kind === 'act') {
    let document = null
    try {
      document = await withStoredTimeout(
        getLegislationDocument(deps.pool, outcome.act.identity),
      )
    } catch {
      return {
        ...emptyResult,
        searched: true,
        note: 'Legislation store unavailable.',
      }
    }
    if (!document) {
      return {
        ...emptyResult,
        searched: true,
        citationRecognised: true,
        recognisedNotHeld: true,
        note: `${outcome.act.title} is not held.`,
      }
    }
    const officialUrl = `https://www.legislation.gov.uk/${document.identity}`
    const actHit: LegislationFetchHit = {
      id: document.identity,
      resultGroup: 'legislation',
      legislationStatus: 'current',
      title: document.title,
      year: document.year,
      // The row renders `provisionLabel · title`, so the title here read as
      // "Sentencing Act 2020 · Sentencing Act 2020". An Act has no provision
      // label; its chapter number is the identifier that distinguishes it.
      provisionLabel: `${document.year} c. ${document.number}`,
      labelPath: '',
      documentIdentity: document.identity,
      extent: document.extent,
      officialUrl,
      sourceUrl: document.sourceUrl,
      notice: 'Open the Act to browse its Parts, sections and schedules.',
      citationMatch: 'exact',
      retrievalPath: 'stored_exact_lookup',
      retrievalRank: 1,
    }
    // A bare Act-name query serves the Act alone. Every provision of an Act
    // carries that Act's title, so all of them match this query equally and
    // the engine breaks the tie by insertion order — which is the identifier
    // path, and `schedule/` sorts before `section/`. That returned a fixed
    // handful of Schedule 1 paragraphs, identical for every Act, presented as
    // if they were the relevant ones. The Act page is the navigation surface
    // for the rest; a query carrying more than the title is no longer an
    // Act-name query and falls to the keyword branch below.
    return {
      groups: [{ key: 'legislation', label: 'Legislation', hits: [actHit] }],
      citationRecognised: true,
      citationHeldExact: true,
      recognisedNotHeld: false,
      titleUnresolved: false,
      ambiguous: false,
      scheduleUnderspecified: null,
      note: null,
      searched: true,
      keywordSearchParameters: null,
    }
  }

  const keyword = await searchKeywordProvisions(
    deps,
    query,
    deps.keywordLimit ?? 5,
  )
  if (keyword.hits.length === 0) {
    return {
      ...emptyResult,
      searched: true,
      keywordSearchParameters: keyword.appliedSearchParameters,
    }
  }
  return {
    groups: [{ key: 'legislation', label: 'Legislation', hits: keyword.hits }],
    citationRecognised: false,
    citationHeldExact: false,
    recognisedNotHeld: false,
    titleUnresolved: false,
    ambiguous: false,
    scheduleUnderspecified: null,
    note: null,
    searched: true,
    keywordSearchParameters: keyword.appliedSearchParameters,
  }
}

async function searchKeywordProvisions(
  deps: LegislationServeDeps,
  query: string,
  limit: number,
): Promise<{
  hits: LegislationFetchHit[]
  appliedSearchParameters: AppliedLegislationSearchParameters | null
}> {
  let result
  try {
    result = await searchLegislation(deps.searchClient, deps.indexName, query, {
      limit,
    })
  } catch {
    return { hits: [], appliedSearchParameters: null }
  }
  const hits = result.hits.slice(0, limit).map((hit, index) =>
    // Fail-closed here too: only explicit false after a successful check
    // serves text; the validator already drops malformed index rows, and
    // unchecked legacy rows carry a null timestamp, so this covers stale
    // index copies and any direct caller.
    provisionTextServable(hit.hasUnappliedEffects, hit.effectsCheckedAt)
      ? {
          ...currentProvisionHit(
            {
              id: hit.id,
              documentIdentity: hit.documentIdentity,
              labelPath: hit.labelPath,
              label: hit.label,
              extent: hit.extent,
              text: hit.text,
              title: hit.title,
              year: hit.year,
              sourceUrl: hit.sourceUrl,
            },
            'stored_index',
            index + 1,
          ),
          citationMatch: undefined,
        }
      : {
          ...amendedProvisionHit(
            {
              id: hit.id,
              documentIdentity: hit.documentIdentity,
              labelPath: hit.labelPath,
              label: hit.label,
              extent: hit.extent,
              title: hit.title,
              year: hit.year,
              sourceUrl: hit.sourceUrl,
            },
            'stored_index',
            index + 1,
          ),
          citationMatch: undefined,
        },
  )
  return { hits, appliedSearchParameters: result.appliedSearchParameters }
}

export interface LegislationProvisionPage {
  provision: {
    id: string
    documentIdentity: string
    title: string
    year: number
    provisionLabel: string
    labelPath: string
    extent: string
    legislationStatus: 'current' | 'amended_not_held'
    text?: string
    officialUrl: string
    sourceUrl: string
    notice?: string
    canonicalUrl: string
  }
}

export type LegislationProvisionPageResult =
  | { status: 'ok'; page: LegislationProvisionPage }
  | { status: 'not_found' }
  | { status: 'unavailable' }

export async function resolveLegislationProvisionPage(
  pool: LegislationServeDeps['pool'],
  provisionId: string,
): Promise<LegislationProvisionPageResult> {
  let provision: StoredLegislationProvision | null
  try {
    provision = await withStoredTimeout(
      getLegislationProvision(pool, provisionId),
    )
  } catch {
    return { status: 'unavailable' }
  }
  if (!provision) return { status: 'not_found' }
  const officialUrl = officialProvisionUrl(
    provision.documentIdentity,
    provision.labelPath,
  )
  const canonicalUrl = createCanonicalProvisionPath(
    provision.documentIdentity,
    provision.labelPath,
  )
  if (
    provisionTextServable(
      provision.hasUnappliedEffects,
      provision.effectsCheckedAt,
    )
  ) {
    return {
      status: 'ok',
      page: {
        provision: {
          id: provision.id,
          documentIdentity: provision.documentIdentity,
          title: provision.title,
          year: provision.year,
          provisionLabel: provision.label,
          labelPath: provision.labelPath,
          extent: provision.extent,
          legislationStatus: 'current',
          text: provision.text,
          officialUrl,
          sourceUrl: provision.sourceUrl,
          canonicalUrl,
        },
      },
    }
  }
  return {
    status: 'ok',
    page: {
      provision: {
        id: provision.id,
        documentIdentity: provision.documentIdentity,
        title: provision.title,
        year: provision.year,
        provisionLabel: provision.label,
        labelPath: provision.labelPath,
        extent: provision.extent,
        legislationStatus: 'amended_not_held',
        officialUrl,
        sourceUrl: provision.sourceUrl,
        notice: amendedProvisionNotice(officialUrl),
        canonicalUrl,
      },
    },
  }
}
