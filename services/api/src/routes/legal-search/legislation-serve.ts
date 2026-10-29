import type { Pool } from 'pg'
import {
  searchLegislation,
  trimSourceExcerpt,
  type AppliedLegislationSearchParameters,
} from '@obiter/search-client'
import {
  classifyLegislationCitation,
  createActDirectory,
  formatScheduleCitation,
  type LegislationActDirectoryEntry,
  type LegislationCitationOutcome,
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
  listLegislationProvisionTree,
  provisionTextServable,
  resolveStoredProvisionPath,
  type StoredProvisionPathResolution,
  type StoredLegislationProvision,
} from './legislation-store'
import {
  amendedProvisionNotice,
  type LegalFetchResultGroup,
  type LegislationFetchHit,
} from './response-utils'

export interface LegislationServeDeps {
  pool: Pick<Pool, 'query'>
  searchClient: Parameters<typeof searchLegislation>[0]
  indexName: string
  keywordLimit?: number
  keywordTimeoutMs?: number
}

export interface LegislationFetchResult {
  groups: LegalFetchResultGroup[]
  citationRecognised: boolean
  citationHeldExact: boolean
  recognisedNotHeld: boolean
  titleUnresolved: boolean
  ambiguous: boolean
  scheduleUnderspecified: LegislationScheduleGuidance | null
  note: string | null
  searched: boolean
  failed: boolean
  keywordSearchParameters: AppliedLegislationSearchParameters | null
}

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

async function withKeywordTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new Error('Legislation keyword search timed out.'))
        }, timeoutMs)
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
  failed: false,
  keywordSearchParameters: null,
}

export function officialProvisionUrl(
  documentIdentity: string,
  labelPath: string,
): string {
  return `https://www.legislation.gov.uk/${documentIdentity}/${labelPath}`
}

async function resolveStoredProvision(
  pool: LegislationServeDeps['pool'],
  identity: string,
  labelPath: string,
): Promise<StoredProvisionPathResolution> {
  return resolveStoredProvisionPath(
    {
      getProvision: (provisionId) =>
        withStoredTimeout(getLegislationProvision(pool, provisionId)),
      pathExists: (documentIdentity, path) =>
        withStoredTimeout(
          legislationProvisionPathExists(pool, documentIdentity, path),
        ),
    },
    identity,
    labelPath,
  )
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
    snippets: [{ text: trimSourceExcerpt(provision.text) }],
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
    return {
      ...emptyResult,
      failed: true,
      note: 'Legislation store unavailable.',
    }
  }
  if (acts.length === 0) return emptyResult
  let outcome: LegislationCitationOutcome
  try {
    const directory = createActDirectory(acts)
    outcome = classifyLegislationCitation(query, directory)
  } catch (error: unknown) {
    console.error(
      'Legislation classification failed — serving an incomplete half.',
      { reason: error instanceof Error ? error.message : String(error) },
    )
    return {
      ...emptyResult,
      failed: true,
      note: 'Legislation search failed.',
    }
  }

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
    return {
      ...emptyResult,
      searched: true,
      citationRecognised: true,
      titleUnresolved: true,
      note: `No exact legislation title match was found for "${outcome.recognisedQuery}".`,
    }
  }

  if (outcome.kind === 'not_held') {
    return {
      ...emptyResult,
      searched: true,
      citationRecognised: true,
      recognisedNotHeld: true,
      note: `${outcome.recognisedQuery} is not held.`,
    }
  }

  if (outcome.kind === 'provision') {
    let resolution: StoredProvisionPathResolution
    try {
      resolution = await resolveStoredProvision(
        deps.pool,
        outcome.provision.identity,
        outcome.provision.labelPath,
      )
    } catch {
      return {
        ...emptyResult,
        searched: false,
        failed: true,
        note: 'Legislation store unavailable.',
      }
    }
    if (resolution.status === 'underspecified') {
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
      failed: false,
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
        searched: false,
        failed: true,
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
      failed: false,
      keywordSearchParameters: null,
    }
  }

  const keyword = await searchKeywordProvisions(
    deps,
    query,
    deps.keywordLimit ?? 5,
  )
  if (keyword.failed) {
    return {
      ...emptyResult,
      failed: true,
      note: 'Legislation index unavailable.',
    }
  }
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
    failed: false,
    keywordSearchParameters: keyword.appliedSearchParameters,
  }
}

async function searchKeywordProvisions(
  deps: LegislationServeDeps,
  query: string,
  limit: number,
): Promise<{
  hits: LegislationFetchHit[]
  failed: boolean
  appliedSearchParameters: AppliedLegislationSearchParameters | null
}> {
  let result
  try {
    result = await withKeywordTimeout(
      (signal) =>
        searchLegislation(deps.searchClient, deps.indexName, query, {
          limit,
          signal,
        }),
      deps.keywordTimeoutMs ?? storedLegislationTimeoutMs,
    )
  } catch {
    return { hits: [], failed: true, appliedSearchParameters: null }
  }
  const hits = result.hits.slice(0, limit).map((hit, index) =>
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
  return {
    hits,
    failed: false,
    appliedSearchParameters: result.appliedSearchParameters,
  }
}

export interface LegislationProvisionSubsection {
  label: string
  labelPath: string
  href: string
  legislationStatus: 'current' | 'amended_not_held'
  text?: string
  children: LegislationProvisionSubsection[]
}

export interface LegislationProvisionPage {
  provision: {
    id: string
    documentIdentity: string
    title: string
    year: number
    provisionLabel: string
    labelPath: string
    heading?: string
    extent: string
    legislationStatus: 'current' | 'amended_not_held'
    text?: string
    subsections?: LegislationProvisionSubsection[]
    officialUrl: string
    sourceUrl: string
    acquiredAt?: string
    notice?: string
    canonicalUrl: string
  }
}

export type LegislationProvisionPageResult =
  | { status: 'ok'; page: LegislationProvisionPage }
  | { status: 'not_found' }
  | { status: 'unavailable' }

function hasStructuredText(row: StoredLegislationProvision) {
  return row.ownText !== null && row.ownText !== undefined
}

function buildSubsectionTree(
  rows: StoredLegislationProvision[],
  documentIdentity: string,
): LegislationProvisionSubsection[] {
  const nodes = new Map<string, LegislationProvisionSubsection>()
  for (const row of rows) {
    const servable = provisionTextServable(
      row.hasUnappliedEffects,
      row.effectsCheckedAt,
    )
    nodes.set(row.labelPath, {
      label: row.label,
      labelPath: row.labelPath,
      href: createCanonicalProvisionPath(documentIdentity, row.labelPath),
      legislationStatus: servable ? 'current' : 'amended_not_held',
      ...(servable
        ? { text: hasStructuredText(row) ? row.ownText || undefined : row.text }
        : {}),
      children: [],
    })
  }
  const roots: LegislationProvisionSubsection[] = []
  for (const row of rows) {
    const node = nodes.get(row.labelPath)
    if (!node) continue
    const parentLabelPath = row.parentLabelPath ?? null
    const parent =
      parentLabelPath === null ? undefined : nodes.get(parentLabelPath)
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

export async function resolveLegislationProvisionPage(
  pool: LegislationServeDeps['pool'],
  provisionId: string,
): Promise<LegislationProvisionPageResult> {
  let provision: StoredLegislationProvision | null
  let tree: StoredLegislationProvision[]
  try {
    provision = await withStoredTimeout(
      getLegislationProvision(pool, provisionId),
    )
    tree = provision
      ? await withStoredTimeout(
          listLegislationProvisionTree(
            pool,
            provision.documentIdentity,
            provision.labelPath,
          ),
        )
      : []
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
  const subsections = buildSubsectionTree(
    tree,
    provision.documentIdentity,
  ).filter((node) => node.labelPath === provision.labelPath)[0]?.children
  const structured = hasStructuredText(provision) ? subsections : undefined
  const shared = {
    id: provision.id,
    documentIdentity: provision.documentIdentity,
    title: provision.title,
    year: provision.year,
    provisionLabel: provision.label,
    labelPath: provision.labelPath,
    extent: provision.extent,
    officialUrl,
    sourceUrl: provision.sourceUrl,
    ...(provision.heading ? { heading: provision.heading } : {}),
    ...(provision.acquiredAt ? { acquiredAt: provision.acquiredAt } : {}),
    canonicalUrl,
  }
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
          ...shared,
          legislationStatus: 'current',
          text: structured ? (provision.ownText ?? '') : provision.text,
          ...(structured ? { subsections: structured } : {}),
        },
      },
    }
  }
  return {
    status: 'ok',
    page: {
      provision: {
        ...shared,
        legislationStatus: 'amended_not_held',
        notice: amendedProvisionNotice(officialUrl),
      },
    },
  }
}
