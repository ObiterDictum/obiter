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

/**
 * Citation resolution (V3): raw citation candidate to canonical identity. It
 * answers one question, whether the candidate resolves unambiguously to the
 * canonical authority it purports to name, and hands a resolved identity to
 * the authority-existence check (V2). It never decides whether an authority is
 * held, never reads Meilisearch, never writes, and never touches matter data:
 * the only store it reads is the public legal-source record.
 *
 * Both database-backed steps are batched per call, not per citation. A
 * document-level caller issues at most one candidate lookup for every case-law
 * citation on the document and one Act-directory read for the legislation
 * citations that need a title resolved. A canonical `/ln/` path needs no store
 * read at all, because the identity is in the path.
 */

/**
 * One already-extracted citation candidate. `id` is the caller's stable
 * identifier for it (for example a paragraph id plus offsets); it is echoed in
 * the result so a document-level caller can map results back without relying on
 * array order. `rawText` is the candidate only, never the paragraph around it.
 */
export interface CitationCandidate {
  id: string
  rawText: string
}

export interface CitationCandidateResolution {
  id: string
  resolution: CitationResolution
}

/**
 * How a raw candidate is resolved. `/ln/` paths are decided by the shared path
 * grammar alone, a neutral citation is validated against the shared grammar and
 * then looked up, and everything else is offered to the legislation classifier.
 * The order matters: a neutral citation is never offered to the legislation
 * classifier, whose title grammar would otherwise see the court words as a
 * title run.
 */
type CandidateShape =
  | 'blank'
  | 'legislation_path'
  | 'case_law'
  | 'case_law_unsupported_court'
  | 'legislation_text'

function candidateShape(rawText: string): CandidateShape {
  // A blank candidate is decided by its own grammar, not by the store: it is
  // outside the accepted grammar whether or not a directory is reachable, so it
  // must never become inconclusive because a read failed.
  if (rawText === '') return 'blank'
  if (rawText.startsWith('/ln/')) return 'legislation_path'
  const neutral = classifyNeutralCitationCandidate(rawText)
  if (neutral === 'citation') return 'case_law'
  if (neutral === 'unsupported_court') return 'case_law_unsupported_court'
  return 'legislation_text'
}

/**
 * Resolve a batch of already-extracted candidates, in input order. The result
 * array is parallel to `candidates`, and each result echoes its candidate id.
 *
 * A dependency that fails makes the candidates that needed it `inconclusive`
 * and leaves the rest alone, so a partial failure is reported as a partial
 * failure rather than as a negative result or as a whole-batch error. Nothing
 * is retried or guessed: an unresolved identity stays unresolved.
 */
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
    // Building the directory is not a store read: a row that cannot be folded
    // is a programmer error, and it propagates rather than reading as an
    // unavailable store.
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

/** Resolve one candidate. Provided for the single-candidate caller; it
 * delegates to the batch so there is one implementation. */
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

/**
 * A store read that could not complete is `inconclusive`, never a negative
 * result: an unreachable record cannot establish that a citation has no
 * identity. The diagnostic carries the dependency and the error message only,
 * never a candidate or matter text.
 */
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
      // A well-formed neutral citation for a court this grammar does not carry
      // is an unsupported source family, not a malformed citation. It is
      // decided from the grammar alone, so an unlisted court is never looked up
      // as though it were supported.
      return { outcome: 'unsupported' }
    case 'legislation_text':
      return resolveLegislationText(rawText, dependencies.directory)
    default: {
      const unhandled: never = shape
      return unhandled
    }
  }
}

/**
 * A pasted canonical path, resolved by the shared path grammar with no store
 * read. A canonical-shaped path naming an act type this repository does not
 * store is an unsupported source family, which is a different answer from a
 * path that is not canonical at all, so a reviewer is told which one it is.
 */
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

/**
 * The one canonical identity for a neutral citation is the stored authority
 * document id, so it takes a store read (one batch call for the whole
 * document). Zero carriers is `unresolved`: it is not evidence that the
 * authority does not exist, and it must not be presented as one.
 *
 * The live/withdrawn carrier rule is shared with the authority-existence check
 * (`selectAuthorityCarriers`), so the two stages cannot disagree about the same
 * store state: one live carrier resolves even when withdrawn historical
 * carriers sit beside it, and two or more live carriers are `ambiguous`. The
 * flag is read through that one rule, not re-derived here.
 *
 * A single withdrawn carrier is still an unambiguous identity and resolves; V2
 * then reports `evidence_unavailable` for it. Two or more withdrawn carriers
 * are not representable through one `sourceId`, and resolution never picks by
 * row order, so it fails closed as `ambiguous` rather than choosing a carrier.
 *
 * `neutralCitation` is the candidate as the caller wrote it, after the trim.
 * The documented folds are applied at comparison, so the identity here is the
 * stored `sourceId`; the stored printed form is deliberately not re-read.
 */
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

/**
 * Free-text legislation: the existing Search classifier resolves the Act title
 * or chapter against the stored directory, and this layer keeps only what
 * resolution owns, the canonical identity and the structured label path.
 * Whether the Act or the provision is held is the authority-existence check's
 * question, so a missing provision of a resolvable Act still resolves and is
 * reported by V2.
 *
 * A chapter citation the directory does not hold is resolved rather than
 * unresolved: the classifier proves the canonical identity from the year and
 * number, so V2 can answer the honest "not held" for it. A title the directory
 * cannot resolve stays unresolved, because the local directory is partial and a
 * failed title lookup is not proof that the Act is absent.
 */
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
