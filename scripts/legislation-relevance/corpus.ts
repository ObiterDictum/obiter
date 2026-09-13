import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { legislationRelevanceCases, type LegislationAbsentCheck } from './cases'
import { canonicalLegislationId, scoreCase, type CaseResult } from './metrics'

const execFileAsync = promisify(execFile)
const fetchTimeoutMs = 30_000

export interface SearchReadinessEntry {
  index: string
  status: string
  exists: boolean
  documentCount: number | null
  reason?: string
}

export interface SearchReadiness {
  index: string
  status: string
  exists: boolean
  documentCount: number | null
  reason?: string
  indexes: SearchReadinessEntry[]
}

export interface ServedLegislationHit {
  id: string
  documentIdentity: string
  labelPath: string
  title: string
}

/**
 * Search-time parameters the measured server reported applying. These are
 * request-time values, so no index setting reveals them: the only honest
 * source is the server that sent them.
 */
export interface ObservedSearchParameters {
  matchingStrategy: string
  rankingScoreThreshold: number | null
}

export interface ServedLegislationResult {
  hits: ServedLegislationHit[]
  outcome: string | null
  legislationNote: string | null
  legislationNotHeld: boolean
  legislationTitleUnresolved: boolean
  searchParameters: ObservedSearchParameters | null
}

export interface ApiProvenance {
  checkoutRoot: string | null
  commitSha: string | null
}

export function defaultApiBase() {
  return process.env.LEGISLATION_RELEVANCE_API_BASE ?? 'http://127.0.0.1:8787'
}

export function defaultLegislationIndexName() {
  return process.env.LEGISLATION_PROVISIONS_INDEX ?? 'legislation_provisions'
}

export function defaultDatabaseUrl() {
  return (
    process.env.LEGISLATION_RELEVANCE_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgres://obiter:obiter@localhost:5432/obiter'
  )
}

export function assertProductDatabaseUrl(databaseUrl: string) {
  if (/obiter_test/i.test(databaseUrl)) {
    throw new Error(
      `Refusing to verify legislation expectations against the test database (${databaseUrl}). Point LEGISLATION_RELEVANCE_DATABASE_URL at the product corpus.`,
    )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : null
}

function readReadinessEntry(value: unknown): SearchReadinessEntry | null {
  if (!isRecord(value) || typeof value.index !== 'string') return null
  if (typeof value.status !== 'string') return null
  const documentCount = value.documentCount
  return {
    index: value.index,
    status: value.status,
    exists: value.exists === true,
    documentCount: typeof documentCount === 'number' ? documentCount : null,
    reason: readString(value.reason) ?? undefined,
  }
}

export async function readReadiness(apiBase: string): Promise<SearchReadiness> {
  const response = await fetch(`${apiBase}/api/search/readiness`, {
    signal: AbortSignal.timeout(fetchTimeoutMs),
  })
  if (!response.ok) {
    throw new Error(`GET /api/search/readiness failed: HTTP ${response.status}`)
  }
  const body: unknown = await response.json()
  if (!isRecord(body) || typeof body.status !== 'string') {
    throw new Error('GET /api/search/readiness returned an unexpected body.')
  }
  const documentCount = body.documentCount
  const indexes = Array.isArray(body.indexes)
    ? body.indexes
        .map(readReadinessEntry)
        .filter((entry): entry is SearchReadinessEntry => entry !== null)
    : []
  return {
    index: readString(body.index) ?? '',
    status: body.status,
    exists: body.exists === true,
    documentCount: typeof documentCount === 'number' ? documentCount : null,
    reason: readString(body.reason) ?? undefined,
    indexes,
  }
}

/**
 * The judgment and legislation corpora have separate indexes and separate
 * readiness entries; measuring with an unready or resized legislation index
 * would record numbers from a corpus the expectations were not written
 * against.
 */
export function assertReadyLegislationIndex(
  readiness: SearchReadiness,
  indexName: string,
  expectedDocumentCount: number,
) {
  const entry =
    readiness.indexes.find((candidate) => candidate.index === indexName) ?? null
  if (!entry) {
    throw new Error(
      `GET /api/search/readiness reported no ${indexName} index; the suite cannot confirm the legislation corpus is served.`,
    )
  }
  if (entry.status !== 'ready') {
    throw new Error(
      `Legislation index ${indexName} is ${entry.status}` +
        (entry.reason ? ` (${entry.reason})` : '') +
        '; the suite measures the served path and needs a ready legislation index.',
    )
  }
  if (entry.documentCount !== expectedDocumentCount) {
    throw new Error(
      `Legislation index ${indexName} documentCount is ${entry.documentCount}, expected ${expectedDocumentCount}. Re-verify every expectation against the corpus before comparing to the baseline; do not measure while a rebuild is running.`,
    )
  }
  return entry
}

export async function readApiProvenance(
  apiBase: string,
): Promise<ApiProvenance> {
  try {
    const response = await fetch(`${apiBase}/api/health`, {
      signal: AbortSignal.timeout(fetchTimeoutMs),
    })
    if (!response.ok) return { checkoutRoot: null, commitSha: null }
    const body: unknown = await response.json()
    const provenance = isRecord(body) ? body.provenance : undefined
    if (!isRecord(provenance)) return { checkoutRoot: null, commitSha: null }
    return {
      checkoutRoot: readString(provenance.checkoutRoot),
      commitSha: readString(provenance.commitSha),
    }
  } catch {
    return { checkoutRoot: null, commitSha: null }
  }
}

/**
 * The settings a run was measured under. Only the fields this package
 * defines are parsed; anything else the server reports is not part of the
 * contract and is not carried into the report.
 */
export interface LiveIndexSettings {
  searchableAttributes: string[] | null
  filterableAttributes: string[] | null
  sortableAttributes: string[] | null
  rankingRules: string[] | null
  stopWords: string[] | null
  prefixSearch: string | null
  minWordSizeForTypos: {
    oneTypo: number | null
    twoTypos: number | null
  } | null
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.filter((item): item is string => typeof item === 'string')
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toLiveIndexSettings(value: unknown): LiveIndexSettings {
  const record = isRecord(value) ? value : {}
  const typoTolerance = isRecord(record.typoTolerance)
    ? record.typoTolerance
    : null
  const typoSize = isRecord(typoTolerance?.minWordSizeForTypos)
    ? typoTolerance.minWordSizeForTypos
    : null
  return {
    searchableAttributes: readStringArray(record.searchableAttributes),
    filterableAttributes: readStringArray(record.filterableAttributes),
    sortableAttributes: readStringArray(record.sortableAttributes),
    rankingRules: readStringArray(record.rankingRules),
    stopWords: readStringArray(record.stopWords),
    prefixSearch: readString(record.prefixSearch),
    minWordSizeForTypos: typoSize
      ? {
          oneTypo: readNumber(typoSize.oneTypo),
          twoTypos: readNumber(typoSize.twoTypos),
        }
      : null,
  }
}

export async function readLiveIndexSettings(
  host: string,
  apiKey: string,
  indexName: string,
): Promise<LiveIndexSettings> {
  const response = await fetch(
    `${host.replace(/\/$/, '')}/indexes/${indexName}/settings`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(fetchTimeoutMs),
    },
  )
  if (!response.ok) {
    throw new Error(
      `GET /indexes/${indexName}/settings failed: HTTP ${response.status}. The report must state the settings it was measured under.`,
    )
  }
  return toLiveIndexSettings(await response.json())
}

export function readAppliedSearchParameters(
  value: unknown,
): ObservedSearchParameters | null {
  if (!isRecord(value)) return null
  const matchingStrategy = readString(value.matchingStrategy)
  if (!matchingStrategy) return null
  if (!('rankingScoreThreshold' in value)) return null
  const rawThreshold = value.rankingScoreThreshold
  let rankingScoreThreshold: number | null
  if (rawThreshold === null) rankingScoreThreshold = null
  else if (typeof rawThreshold === 'number' && Number.isFinite(rawThreshold)) {
    rankingScoreThreshold = rawThreshold
  } else {
    return null
  }
  return { matchingStrategy, rankingScoreThreshold }
}

/**
 * Sends one query through the served path and reads the legislation group
 * only. Judgment hits share the response and are none of this suite's
 * business; a query the judgment half answers well must not inflate a
 * legislation score, or the reverse.
 */
export async function fetchLegislationSearch(
  apiBase: string,
  query: string,
): Promise<ServedLegislationResult> {
  const response = await fetch(`${apiBase}/api/search/fetch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(fetchTimeoutMs),
  })
  if (!response.ok) {
    throw new Error(
      `POST /api/search/fetch failed for ${JSON.stringify(query)}: HTTP ${response.status}`,
    )
  }
  const body: unknown = await response.json()
  if (!isRecord(body)) {
    throw new Error(
      `POST /api/search/fetch returned an unexpected body for ${JSON.stringify(query)}.`,
    )
  }
  const groups = Array.isArray(body.groups) ? body.groups : []
  const legislationGroup = groups.find(
    (group): group is Record<string, unknown> =>
      isRecord(group) && group.key === 'legislation',
  )
  const rawHits = Array.isArray(legislationGroup?.hits)
    ? (legislationGroup.hits as unknown[])
    : []
  const hits = rawHits.map((hit, index) => {
    if (
      !isRecord(hit) ||
      typeof hit.documentIdentity !== 'string' ||
      typeof hit.labelPath !== 'string'
    ) {
      throw new Error(
        `Legislation hit ${index} has no identity for ${JSON.stringify(query)}.`,
      )
    }
    return {
      id: readString(hit.id) ?? '',
      documentIdentity: hit.documentIdentity,
      labelPath: hit.labelPath,
      title: readString(hit.title) ?? '',
    }
  })
  const diagnostics = isRecord(body.diagnostics) ? body.diagnostics : undefined
  return {
    hits,
    outcome: readString(body.outcome),
    legislationNote: readString(diagnostics?.legislationNote),
    legislationNotHeld: diagnostics?.legislationNotHeld === true,
    legislationTitleUnresolved:
      diagnostics?.legislationTitleUnresolved === true,
    // Only what the server reported. The suite's own constants are not
    // evidence: the server may be running a different checkout.
    searchParameters: readAppliedSearchParameters(
      diagnostics?.legislationSearchParameters,
    ),
  }
}

async function psql(databaseUrl: string, sql: string) {
  const { stdout, stderr } = await execFileAsync(
    'psql',
    [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-tAc', sql],
    { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 },
  )
  if (stderr.trim().length > 0 && /ERROR:/i.test(stderr)) {
    throw new Error(stderr.trim())
  }
  return stdout
}

function sqlStringList(values: string[]) {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ')
}

function lines(output: string) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * Every held expectation must exist in Postgres (the record), and every
 * absent expectation must be absent from it. An expectation that has quietly
 * drifted is worse than no expectation: it scores the engine against a
 * corpus that no longer matches.
 */
export async function verifyLegislationExpectations(databaseUrl: string) {
  assertProductDatabaseUrl(databaseUrl)
  const heldIds = [
    ...new Set(
      legislationRelevanceCases.flatMap((testCase) => testCase.expectedIds),
    ),
  ]
  const known = new Set<string>([
    ...lines(
      await psql(
        databaseUrl,
        `select identity from legislation_documents
          where identity in (${sqlStringList(heldIds)})`,
      ),
    ),
    ...lines(
      await psql(
        databaseUrl,
        `select id from legislation_provisions
          where id in (${sqlStringList(heldIds)})`,
      ),
    ),
  ])
  const missingHeld = heldIds.filter((id) => !known.has(id))
  if (missingHeld.length > 0) {
    throw new Error(
      `Held expectations are missing from the corpus: ${missingHeld.join(', ')}. An expectation that is wrong is worse than no expectation.`,
    )
  }

  for (const testCase of legislationRelevanceCases) {
    if (testCase.kind !== 'absent' || !testCase.absentCheck) continue
    const violation = await absentViolation(databaseUrl, testCase.absentCheck)
    if (violation) {
      throw new Error(
        `Absent case ${testCase.id} is no longer absent: ${violation}.`,
      )
    }
  }
}

async function absentViolation(
  databaseUrl: string,
  check: LegislationAbsentCheck,
): Promise<string | null> {
  switch (check.kind) {
    case 'act_not_held': {
      const found = lines(
        await psql(
          databaseUrl,
          `select title from legislation_documents
            where lower(title) = lower(${sqlStringList([check.title])})`,
        ),
      )
      return found.length > 0 ? `held as ${found.join(', ')}` : null
    }
    case 'provision_not_held': {
      const found = lines(
        await psql(
          databaseUrl,
          `select id from legislation_provisions
            where id = ${sqlStringList([check.provisionId])}`,
        ),
      )
      return found.length > 0 ? `held as ${found.join(', ')}` : null
    }
    case 'chapter_not_held': {
      const found = lines(
        await psql(
          databaseUrl,
          `select identity from legislation_documents
            where year = ${check.year} and number = ${check.number}`,
        ),
      )
      return found.length > 0 ? `held as ${found.join(', ')}` : null
    }
    case 'term_not_in_corpus': {
      for (const term of check.terms) {
        const count = Number(
          (
            await psql(
              databaseUrl,
              `select count(*) from legislation_provisions
                where kind = 'P1'
                  and provision_text ilike ${sqlStringList([`%${term}%`])}`,
            )
          ).trim(),
        )
        if (count > 0)
          return `${count} provision(s) contain ${JSON.stringify(term)}`
      }
      return null
    }
  }
}

export interface LegislationRunOutcome {
  results: CaseResult[]
  /**
   * The parameters the measured server reported applying, null when it
   * reported none. Null is not silently recorded as a configuration: run.ts
   * refuses to write a report without it.
   */
  searchParameters: ObservedSearchParameters | null
}

export async function runCases(
  apiBase: string,
): Promise<LegislationRunOutcome> {
  const results: CaseResult[] = []
  const observed = new Map<string, ObservedSearchParameters>()
  for (const testCase of legislationRelevanceCases) {
    const outcome = await runOneCase(apiBase, testCase)
    results.push(outcome.result)
    if (outcome.searchParameters) {
      observed.set(
        JSON.stringify(outcome.searchParameters),
        outcome.searchParameters,
      )
    }
  }
  if (observed.size > 1) {
    const conflicts = [...observed.keys()].join(' vs ')
    throw new Error(
      `The measured server reported different legislation search parameters across queries (${conflicts}). Refusing to record conditions that moved during the run.`,
    )
  }
  return { results, searchParameters: [...observed.values()][0] ?? null }
}

async function runOneCase(
  apiBase: string,
  testCase: (typeof legislationRelevanceCases)[number],
): Promise<{
  result: CaseResult
  searchParameters: ObservedSearchParameters | null
}> {
  try {
    const body = await fetchLegislationSearch(apiBase, testCase.query)
    const returnedIds = body.hits.map((hit) => canonicalLegislationId(hit))
    return {
      result: scoreCase(testCase, returnedIds, {
        outcome: body.outcome,
        legislationNote: body.legislationNote,
        legislationNotHeld: body.legislationNotHeld,
        legislationTitleUnresolved: body.legislationTitleUnresolved,
      }),
      searchParameters: body.searchParameters,
    }
  } catch (error) {
    return {
      result: scoreCase(testCase, [], {
        searchErrorMessage:
          error instanceof Error ? error.message : String(error),
      }),
      searchParameters: null,
    }
  }
}
