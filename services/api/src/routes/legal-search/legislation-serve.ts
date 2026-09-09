import type { Pool } from 'pg'
import { searchLegislation } from '@obiter/search-client'
import {
  classifyLegislationCitation,
  createActDirectory,
  type LegislationActDirectoryEntry,
} from './legislation-citations'
import {
  getLegislationDocument,
  getLegislationProvision,
  listLegislationActs,
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
  recognisedNotHeld: boolean
  note: string | null
  searched: boolean
}

// Bounds every stored lookup, mirroring the judgment half: a slow store
// fails this half open (no group) rather than holding the route.
const storedLegislationTimeoutMs = 2000

async function withStoredTimeout<T>(promise: Promise<T>): Promise<T> {
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
  note: null,
  searched: false,
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

function currentProvisionHit(
  provision: {
    id: string
    documentIdentity: string
    labelPath: string
    label: string
    extent: string
    text: string
    title: string
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
    provisionLabel: provision.label,
    labelPath: provision.labelPath,
    documentIdentity: provision.documentIdentity,
    extent: provision.extent,
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
    provisionLabel: provision.label,
    labelPath: provision.labelPath,
    documentIdentity: provision.documentIdentity,
    extent: provision.extent,
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
      recognisedNotHeld: true,
      note: `${outcome.reason} Candidates: ${names}`,
    }
  }

  if (outcome.kind === 'provision') {
    let provision = null
    try {
      provision = await withStoredTimeout(
        getLegislationProvision(deps.pool, outcome.provision.provisionId),
      )
    } catch {
      return {
        ...emptyResult,
        searched: true,
        note: 'Legislation store unavailable.',
      }
    }
    if (!provision) {
      return {
        ...emptyResult,
        searched: true,
        citationRecognised: true,
        recognisedNotHeld: true,
        note:
          `${outcome.provision.label} of ${outcome.provision.title} is not held ` +
          `(official text: ${officialProvisionUrl(outcome.provision.identity, outcome.provision.labelPath)}).`,
      }
    }
    const hit = provision.hasUnappliedEffects
      ? amendedProvisionHit(provision, 'stored_exact_lookup', 1)
      : currentProvisionHit(provision, 'stored_exact_lookup', 1)
    return {
      groups: [{ key: 'legislation', label: 'Legislation', hits: [hit] }],
      citationRecognised: true,
      citationHeldExact: true,
      recognisedNotHeld: false,
      note: null,
      searched: true,
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
      provisionLabel: document.title,
      labelPath: '',
      documentIdentity: document.identity,
      extent: document.extent,
      officialUrl,
      sourceUrl: document.sourceUrl,
      notice: `Matched ${document.title}. Add a section number (for example s. 40) to read a provision.`,
      citationMatch: 'exact',
      retrievalPath: 'stored_exact_lookup',
      retrievalRank: 1,
    }
    const keywordHits = await searchKeywordProvisions(deps, query, 2)
    return {
      groups: [
        {
          key: 'legislation',
          label: 'Legislation',
          hits: [actHit, ...keywordHits],
        },
      ],
      citationRecognised: true,
      citationHeldExact: true,
      recognisedNotHeld: false,
      note: null,
      searched: true,
    }
  }

  const keywordHits = await searchKeywordProvisions(
    deps,
    query,
    deps.keywordLimit ?? 5,
  )
  if (keywordHits.length === 0) return { ...emptyResult, searched: true }
  return {
    groups: [{ key: 'legislation', label: 'Legislation', hits: keywordHits }],
    citationRecognised: false,
    citationHeldExact: false,
    recognisedNotHeld: false,
    note: null,
    searched: true,
  }
}

async function searchKeywordProvisions(
  deps: LegislationServeDeps,
  query: string,
  limit: number,
): Promise<LegislationFetchHit[]> {
  let result
  try {
    result = await searchLegislation(deps.searchClient, deps.indexName, query, {
      limit,
    })
  } catch {
    return []
  }
  return result.hits.slice(0, limit).map((hit, index) =>
    hit.hasUnappliedEffects
      ? {
          ...amendedProvisionHit(
            {
              id: hit.id,
              documentIdentity: hit.documentIdentity,
              labelPath: hit.labelPath,
              label: hit.label,
              extent: hit.extent,
              title: hit.title,
              sourceUrl: hit.sourceUrl,
            },
            'stored_index',
            index + 1,
          ),
          citationMatch: undefined,
        }
      : {
          ...currentProvisionHit(
            {
              id: hit.id,
              documentIdentity: hit.documentIdentity,
              labelPath: hit.labelPath,
              label: hit.label,
              extent: hit.extent,
              text: hit.text,
              title: hit.title,
              sourceUrl: hit.sourceUrl,
            },
            'stored_index',
            index + 1,
          ),
          citationMatch: undefined,
        },
  )
}
