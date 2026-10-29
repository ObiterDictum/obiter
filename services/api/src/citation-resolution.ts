import type { Pool } from 'pg'
import {
  classifyNeutralCitationCandidate,
  isSupportedLegislationActType,
} from '@obiter/contracts'
import { normalizeCitationValue } from '@obiter/search-client'
import {
  isCanonicalLegislationPath,
  normalizeLegislationCitationPath,
  type CitationResolution,
  type ResolvedCitation,
} from '@obiter/verification-core'
import {
  classifyLegislationCitation,
  createActDirectory,
  type ActDirectory,
} from './routes/legal-search/legislation-citations'
import {
  findStoredAuthorityCarriersByNeutralCitations,
  selectAuthorityCarriers,
  type StoredAuthorityCarrier,
} from './routes/legal-search/source-store'
import { listLegislationActs } from './routes/legal-search/legislation-store'

export interface CitationCandidate {
  id: string
  rawText: string
}

export interface CitationCandidateResolution {
  id: string
  resolution: CitationResolution
}

type CandidateShape =
  | 'blank'
  | 'legislation_path'
  | 'case_law'
  | 'case_law_unsupported_court'
  | 'legislation_text'

function candidateShape(rawText: string): CandidateShape {
  if (rawText === '') return 'blank'
  if (rawText.startsWith('/ln/')) return 'legislation_path'
  const neutral = classifyNeutralCitationCandidate(rawText)
  if (neutral === 'citation') return 'case_law'
  if (neutral === 'unsupported_court') return 'case_law_unsupported_court'
  return 'legislation_text'
}

export async function resolveCitationCandidates(
  pool: Pick<Pool, 'query'>,
  candidates: readonly CitationCandidate[],
): Promise<CitationCandidateResolution[]> {
  if (candidates.length === 0) return []

  const prepared = candidates.map((candidate) => {
    const text = candidate.rawText.trim()
    return { id: candidate.id, text, shape: candidateShape(text) }
  })

  const caseLawCitations = prepared
    .filter((candidate) => candidate.shape === 'case_law')
    .map((candidate) => candidate.text)
  let caseLawMatches: Map<string, StoredAuthorityCarrier[]> | null = null
  if (caseLawCitations.length > 0) {
    caseLawMatches = await readStoreDependency('case_law_lookup', () =>
      findStoredAuthorityCarriersByNeutralCitations(pool, caseLawCitations),
    )
  }

  let directory: ActDirectory | null = null
  if (prepared.some((candidate) => candidate.shape === 'legislation_text')) {
    const acts = await readStoreDependency('legislation_directory', () =>
      listLegislationActs(pool),
    )
    if (acts !== null) directory = createActDirectory(acts)
  }

  return prepared.map((candidate) => ({
    id: candidate.id,
    resolution: resolveOne(candidate.text, candidate.shape, {
      caseLawMatches,
      directory,
    }),
  }))
}

export async function resolveCitationCandidate(
  pool: Pick<Pool, 'query'>,
  candidate: CitationCandidate,
): Promise<CitationResolution> {
  const [resolved] = await resolveCitationCandidates(pool, [candidate])
  if (!resolved) {
    throw new Error('Citation resolution returned no result for one candidate.')
  }
  return resolved.resolution
}

async function readStoreDependency<T>(
  dependency: 'case_law_lookup' | 'legislation_directory',
  read: () => Promise<T>,
): Promise<T | null> {
  try {
    return await read()
  } catch (error) {
    console.warn('Citation resolution store read failed', {
      dependency,
      message: error instanceof Error ? error.message : null,
    })
    return null
  }
}

interface ResolutionDependencies {
  caseLawMatches: Map<string, StoredAuthorityCarrier[]> | null
  directory: ActDirectory | null
}

function resolveOne(
  rawText: string,
  shape: CandidateShape,
  dependencies: ResolutionDependencies,
): CitationResolution {
  switch (shape) {
    case 'blank':
      return { outcome: 'malformed' }
    case 'legislation_path':
      return resolveLegislationPath(rawText)
    case 'case_law':
      return resolveCaseLaw(rawText, dependencies.caseLawMatches)
    case 'case_law_unsupported_court':
      return { outcome: 'unsupported' }
    case 'legislation_text':
      return resolveLegislationText(rawText, dependencies.directory)
    default: {
      const unhandled: never = shape
      return unhandled
    }
  }
}

function resolveLegislationPath(rawText: string): CitationResolution {
  const normalized = normalizeLegislationCitationPath(rawText)
  if (normalized) return { outcome: 'resolved', citation: normalized }

  const path = rawText.startsWith('/ln/') ? rawText.slice('/ln/'.length) : ''
  const [actType = ''] = path.split('/')
  return isCanonicalLegislationPath(path) &&
    !isSupportedLegislationActType(actType)
    ? { outcome: 'unsupported' }
    : { outcome: 'malformed' }
}

function resolveCaseLaw(
  rawText: string,
  matches: Map<string, StoredAuthorityCarrier[]> | null,
): CitationResolution {
  if (matches === null)
    return { outcome: 'inconclusive', reason: 'store_error' }
  const selection = selectAuthorityCarriers(
    matches.get(normalizeCitationValue(rawText)) ?? [],
  )
  switch (selection.kind) {
    case 'none':
      return { outcome: 'unresolved' }
    case 'ambiguous':
      return { outcome: 'ambiguous' }
    case 'no_live': {
      const [only, ...rest] = selection.ids
      return only && rest.length === 0
        ? resolvedCaseLaw(rawText, only)
        : { outcome: 'ambiguous' }
    }
    case 'single_live':
      return resolvedCaseLaw(rawText, selection.id)
  }
}

function resolvedCaseLaw(
  neutralCitation: string,
  sourceId: string,
): CitationResolution {
  return {
    outcome: 'resolved',
    citation: { kind: 'case_law', neutralCitation, sourceId },
  }
}

function resolveLegislationText(
  rawText: string,
  directory: ActDirectory | null,
): CitationResolution {
  if (directory === null) {
    return { outcome: 'inconclusive', reason: 'store_error' }
  }
  const outcome = classifyLegislationCitation(rawText, directory)
  switch (outcome.kind) {
    case 'act':
      return resolvedLegislation(outcome.act.identity, null)
    case 'provision':
      return resolvedLegislation(
        outcome.provision.identity,
        outcome.provision.labelPath,
      )
    case 'not_held':
      return resolvedLegislation(outcome.identity, null)
    case 'ambiguous':
      return { outcome: 'ambiguous' }
    case 'unresolved_title':
      return { outcome: 'unresolved' }
    case 'unrecognised':
      return { outcome: 'malformed' }
    default: {
      const unhandled: never = outcome
      return unhandled
    }
  }
}

function resolvedLegislation(
  documentIdentity: string,
  labelPath: string | null,
): CitationResolution {
  const citation: ResolvedCitation = {
    kind: 'legislation',
    documentIdentity,
    labelPath,
  }
  return { outcome: 'resolved', citation }
}
