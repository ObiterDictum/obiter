import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { corpusRelevanceCases, type CorpusRelevanceCase } from './cases'
import { scoreCase, splitAbsentScoringIds, type CaseResult } from './metrics'

const execFileAsync = promisify(execFile)
const fetchTimeoutMs = 30_000

export interface SearchReadiness {
  index: string
  status: string
  exists: boolean
  documentCount: number | null
  reason?: string
}

export interface FetchHit {
  id: string
  citationMatch?: string | null
}

export interface FetchResponse {
  hits: FetchHit[]
  outcome?: string
  diagnostics?: {
    storedIndexStatus?: string
  }
}

export function defaultApiBase() {
  return process.env.SEARCH_CORPUS_RELEVANCE_API_BASE ?? 'http://127.0.0.1:8787'
}

export function defaultDatabaseUrl() {
  return (
    process.env.SEARCH_CORPUS_RELEVANCE_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgres://obiter:obiter@localhost:5432/obiter'
  )
}

export function assertProductDatabaseUrl(databaseUrl: string) {
  if (/obiter_test/i.test(databaseUrl)) {
    throw new Error(
      `Refusing to verify corpus expectations against the test database (${databaseUrl}). Point SEARCH_CORPUS_RELEVANCE_DATABASE_URL at the product corpus.`,
    )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : null
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
  return {
    index: readString(body.index) ?? '',
    status: body.status,
    exists: body.exists === true,
    documentCount: typeof documentCount === 'number' ? documentCount : null,
    reason: readString(body.reason) ?? undefined,
  }
}

export function assertReadyCorpus(
  readiness: SearchReadiness,
  expectedDocumentCount: number,
) {
  if (readiness.status !== 'ready') {
    throw new Error(
      `Search index is ${readiness.status}` +
        (readiness.reason ? ` (${readiness.reason})` : '') +
        '; the corpus relevance suite measures the served path and needs a ready product index.',
    )
  }
  if (readiness.documentCount !== expectedDocumentCount) {
    throw new Error(
      `Search index documentCount is ${readiness.documentCount}, expected ${expectedDocumentCount}. Re-verify every expectation against the corpus before comparing to the baseline; do not measure while ingest is running.`,
    )
  }
}

export async function fetchSearch(
  apiBase: string,
  query: string,
): Promise<FetchResponse> {
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
  if (!isRecord(body) || !Array.isArray(body.hits)) {
    throw new Error(
      `POST /api/search/fetch returned an unexpected body for ${JSON.stringify(query)}.`,
    )
  }
  const diagnostics = isRecord(body.diagnostics) ? body.diagnostics : undefined
  return {
    hits: body.hits.map((hit, index) => {
      if (!isRecord(hit) || typeof hit.id !== 'string') {
        throw new Error(
          `POST /api/search/fetch hit ${index} has no id for ${JSON.stringify(query)}.`,
        )
      }
      return {
        id: hit.id,
        citationMatch:
          typeof hit.citationMatch === 'string' ? hit.citationMatch : null,
      }
    }),
    outcome: readString(body.outcome) ?? undefined,
    diagnostics: diagnostics
      ? {
          storedIndexStatus:
            readString(diagnostics.storedIndexStatus) ?? undefined,
        }
      : undefined,
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

export async function verifyCorpusExpectations(databaseUrl: string) {
  assertProductDatabaseUrl(databaseUrl)
  const heldIds = [
    ...new Set(
      corpusRelevanceCases.flatMap((testCase) => testCase.expectedIds),
    ),
  ]
  const absentCitations = corpusRelevanceCases
    .filter((testCase) => testCase.kind === 'absent')
    .map((testCase) => testCase.query)

  const foundIds = new Set(
    (
      await psql(
        databaseUrl,
        `select document_id from legal_source_documents
         where document_id in (${sqlStringList(heldIds)})
           and provider_json->>'withdrawn' is null`,
      )
    )
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  )
  const missingIds = heldIds.filter((id) => !foundIds.has(id))
  if (missingIds.length > 0) {
    throw new Error(
      `Held expectations are missing from the corpus: ${missingIds.join(', ')}. An expectation that is wrong is worse than no expectation.`,
    )
  }

  const presentCitations = (
    await psql(
      databaseUrl,
      `select summary_json->>'neutralCitation'
       from legal_source_documents
       where summary_json->>'neutralCitation' in (${sqlStringList(absentCitations)})
         and provider_json->>'withdrawn' is null`,
    )
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (presentCitations.length > 0) {
    throw new Error(
      `Absent-citation expectations now exist in the corpus: ${presentCitations.join(', ')}. Drop or invert those cases before measuring.`,
    )
  }
}

export async function runCases(apiBase: string): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  for (const testCase of corpusRelevanceCases) {
    results.push(await runOneCase(apiBase, testCase))
  }
  return results
}

async function runOneCase(
  apiBase: string,
  testCase: CorpusRelevanceCase,
): Promise<CaseResult> {
  try {
    const body = await fetchSearch(apiBase, testCase.query)
    const hits = body.hits ?? []
    // Absent citations honestly serve labelled citing judgments (status
    // not_held); those are the distinguished answer, not false positives.
    // Score only hits that could read as the judgment itself.
    if (testCase.kind === 'absent') {
      const { violatingIds, exemptLabelledCitingCount } =
        splitAbsentScoringIds(hits)
      return scoreCase(testCase, violatingIds, {
        storedIndexStatus: body.diagnostics?.storedIndexStatus ?? null,
        outcome: body.outcome ?? null,
        exemptLabelledCitingCount,
      })
    }
    const returnedIds = hits.map((hit) => hit.id)
    return scoreCase(testCase, returnedIds, {
      storedIndexStatus: body.diagnostics?.storedIndexStatus ?? null,
      outcome: body.outcome ?? null,
    })
  } catch (error) {
    return scoreCase(testCase, [], {
      searchErrorMessage:
        error instanceof Error ? error.message : String(error),
    })
  }
}
