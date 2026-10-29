import { createHash } from 'node:crypto'
import { Pool } from 'pg'
import { pathToFileURL } from 'node:url'
import {
  createMojRateLimiter,
  readWithdrawalCandidate,
  resolveProviderUrl,
  type MojRateLimiter,
  type WithdrawalCandidate,
  type WithdrawnInfo,
} from '@obiter/legal-source-provider'
import { createClient, deleteDocuments } from '@obiter/search-client'
import { readLegalIngestorEnv } from './env'
import { settledRequestGapMs, type Db } from './bulk-ingest'

export const confirmGapMs = 24 * 60 * 60 * 1000
const requestTimeoutMs = 15_000
const notFoundBodyMarker = 'Page not found'
const maxBodyChars = 65_536

export type {
  WithdrawalCandidate,
  WithdrawnInfo,
} from '@obiter/legal-source-provider'

export type UriCheckOutcome = 'present' | 'not_found' | 'inconclusive'

export interface UriCheck {
  uri: string
  outcome: UriCheckOutcome
  httpStatus: number | null
  bodySnippetHash: string | null
}

export type WithdrawalSignal =
  'double_not_found' | 'single_not_found' | 'present' | 'inconclusive'

export type WithdrawalDecision = 'mark_candidate' | 'mark_withdrawn' | 'none'

export interface WithdrawalReport {
  runId: string
  checked: number
  present: number
  candidates: number
  withdrawn: string[]
  inconclusive: number
  indexRemovalFailures: Array<{ documentId: string; reason: string }>
  aborted: boolean
  abortReason: string | null
}

export const withdrawalConfirmationFloor = 10
export const withdrawalConfirmationRate = 0.01

export function withdrawalConfirmationLimit(checked: number): number {
  if (checked <= 0) return withdrawalConfirmationFloor
  return Math.max(
    withdrawalConfirmationFloor,
    Math.ceil(checked * withdrawalConfirmationRate),
  )
}

export function shouldAbortWithdrawalRun(
  checked: number,
  confirmations: number,
): boolean {
  return confirmations > withdrawalConfirmationLimit(checked)
}

export function classifyUriResponse(
  status: number,
  bodyText: string | null,
): UriCheckOutcome {
  if (status === 429 || status >= 500) return 'inconclusive'
  if (status === 404) {
    return bodyText !== null && bodyText.includes(notFoundBodyMarker)
      ? 'not_found'
      : 'inconclusive'
  }
  if (status >= 200 && status < 300) return 'present'
  return 'inconclusive'
}

export function combineUriChecks(checks: UriCheck[]): WithdrawalSignal {
  if (checks.length === 0) return 'inconclusive'
  if (checks.some((check) => check.outcome === 'inconclusive'))
    return 'inconclusive'
  if (checks.every((check) => check.outcome === 'not_found')) {
    return checks.length > 1 ? 'double_not_found' : 'single_not_found'
  }
  if (checks.some((check) => check.outcome === 'not_found'))
    return 'single_not_found'
  return 'present'
}

export function evaluateWithdrawal(
  candidate: WithdrawalCandidate | null,
  signal: WithdrawalSignal,
  nowMs: number,
  runId: string,
  options?: { singleUri?: boolean },
): WithdrawalDecision {
  if (signal !== 'double_not_found' && signal !== 'single_not_found')
    return 'none'
  if (!candidate) return 'mark_candidate'
  if (signal === 'single_not_found' && !options?.singleUri) return 'none'
  if (candidate.runId === runId) return 'none'
  const firstSeen = Date.parse(candidate.firstSeenAt)
  if (!Number.isFinite(firstSeen)) return 'mark_candidate'
  return nowMs - firstSeen >= confirmGapMs ? 'mark_withdrawn' : 'none'
}

export function hashBodySnippet(bodyText: string): string {
  return createHash('sha256').update(bodyText.slice(0, 2000)).digest('hex')
}

export interface WithdrawalCheckDeps {
  pool: Db
  baseUrl: string
  limiter: MojRateLimiter
  gapMs: number
  sleep: (ms: number) => Promise<void>
  fetchImpl: typeof fetch
  now: () => number
  runId: string
  pageSize: number
  timeoutMs: number
  deleteFromIndex: (documentIds: string[]) => Promise<void>
}

export function createWithdrawalDeps(
  pool: Db,
  baseUrl: string,
  runId: string,
  rateLimit: number,
  deleteFromIndex: (documentIds: string[]) => Promise<void>,
  overrides?: Partial<
    Pick<
      WithdrawalCheckDeps,
      'gapMs' | 'sleep' | 'fetchImpl' | 'now' | 'pageSize' | 'timeoutMs'
    >
  >,
): WithdrawalCheckDeps {
  return {
    pool,
    baseUrl,
    limiter: createMojRateLimiter(rateLimit),
    gapMs: overrides?.gapMs ?? settledRequestGapMs,
    sleep:
      overrides?.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    fetchImpl: overrides?.fetchImpl ?? fetch,
    now: overrides?.now ?? Date.now,
    runId,
    pageSize: overrides?.pageSize ?? 200,
    timeoutMs: overrides?.timeoutMs ?? requestTimeoutMs,
    deleteFromIndex,
  }
}

async function takePolitely(deps: WithdrawalCheckDeps) {
  await deps.sleep(deps.gapMs)
  for (;;) {
    const taken = deps.limiter.take()
    if (taken.allowed) return
    await deps.sleep(taken.retryAfterSeconds * 1000 + deps.gapMs)
  }
}

async function checkUri(
  deps: WithdrawalCheckDeps,
  uri: string,
): Promise<UriCheck> {
  const failed = (httpStatus: number | null): UriCheck => ({
    uri,
    outcome: 'inconclusive',
    httpStatus,
    bodySnippetHash: null,
  })
  const target = resolveProviderUrl(deps.baseUrl, uri)
  if (!target) return failed(null)
  await takePolitely(deps)
  let response: Response
  try {
    response = await deps.fetchImpl(target.toString(), {
      signal: AbortSignal.timeout(deps.timeoutMs),
      redirect: 'manual',
    })
  } catch {
    return failed(null)
  }
  if (response.status === 429 || response.status >= 500) {
    return failed(response.status)
  }
  if (response.status === 404 || !response.ok) {
    let body: string | null = null
    try {
      const text = await response.text()
      body = text.length > maxBodyChars ? text.slice(0, maxBodyChars) : text
    } catch {
      return failed(response.status)
    }
    const outcome = classifyUriResponse(response.status, body)
    return {
      uri,
      outcome,
      httpStatus: response.status,
      bodySnippetHash: body === null ? null : hashBodySnippet(body),
    }
  }
  return {
    uri,
    outcome: 'present',
    httpStatus: response.status,
    bodySnippetHash: null,
  }
}

interface StoredWithdrawalRow {
  document_id: string
  source_uri: string
  xml_uri: string | null
  provider_json: unknown
}

interface PendingWithdrawal {
  row: StoredWithdrawalRow
  signal: WithdrawalSignal
  decision: WithdrawalDecision
  candidate: WithdrawalCandidate | null
  checkedUris: string[]
}

async function probeOne(
  deps: WithdrawalCheckDeps,
  row: StoredWithdrawalRow,
): Promise<PendingWithdrawal> {
  const uris = row.xml_uri ? [row.source_uri, row.xml_uri] : [row.source_uri]
  const checks: UriCheck[] = []
  for (const uri of uris) {
    checks.push(await checkUri(deps, uri))
  }
  const signal = combineUriChecks(checks)
  const candidate = readWithdrawalCandidate(row.provider_json)
  const decision = evaluateWithdrawal(
    candidate,
    signal,
    deps.now(),
    deps.runId,
    {
      singleUri: uris.length === 1,
    },
  )

  for (const check of checks) {
    await deps.pool.query(
      `insert into legal_source_withdrawal_audits
        (document_id, uri, http_status, body_snippet_hash, run_id, outcome)
        values ($1, $2, $3, $4, $5, $6)`,
      [
        row.document_id,
        check.uri,
        check.httpStatus,
        check.bodySnippetHash,
        deps.runId,
        check.outcome,
      ],
    )
  }

  return {
    row,
    signal,
    decision,
    candidate,
    checkedUris: checks.map((check) => check.uri),
  }
}

async function applyOne(
  deps: WithdrawalCheckDeps,
  pending: PendingWithdrawal,
  report: WithdrawalReport,
): Promise<void> {
  const { row, signal, decision, candidate, checkedUris } = pending
  if (decision === 'mark_candidate') {
    const next: WithdrawalCandidate = {
      firstSeenAt: new Date(deps.now()).toISOString(),
      runId: deps.runId,
      checkedUris,
    }
    await deps.pool.query(
      `update legal_source_documents
        set provider_json = legal_source_documents.provider_json || $2::jsonb,
          updated_at = now()
        where document_id = $1`,
      [row.document_id, JSON.stringify({ withdrawalCandidate: next })],
    )
    report.candidates += 1
  } else if (decision === 'mark_withdrawn') {
    const withdrawn: WithdrawnInfo = {
      at: new Date(deps.now()).toISOString(),
      checkedUris,
      runIds: candidate ? [candidate.runId, deps.runId] : [deps.runId],
    }
    await deps.pool.query(
      `update legal_source_documents
        set provider_json =
            (legal_source_documents.provider_json - 'withdrawalCandidate') || $2::jsonb,
          updated_at = now()
        where document_id = $1`,
      [row.document_id, JSON.stringify({ withdrawn })],
    )
    try {
      await deps.deleteFromIndex([row.document_id])
    } catch (error) {
      report.indexRemovalFailures.push({
        documentId: row.document_id,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
    report.withdrawn.push(row.document_id)
  } else if (signal === 'present') {
    if (candidate) {
      await deps.pool.query(
        `update legal_source_documents
          set provider_json = legal_source_documents.provider_json - 'withdrawalCandidate',
            updated_at = now()
          where document_id = $1`,
        [row.document_id],
      )
    }
    report.present += 1
  } else if (signal === 'inconclusive') {
    report.inconclusive += 1
  } else {
    report.candidates += 1
  }
  report.checked += 1
}

export async function runWithdrawalCheck(
  deps: WithdrawalCheckDeps,
): Promise<WithdrawalReport> {
  const report: WithdrawalReport = {
    runId: deps.runId,
    checked: 0,
    present: 0,
    candidates: 0,
    withdrawn: [],
    inconclusive: 0,
    indexRemovalFailures: [],
    aborted: false,
    abortReason: null,
  }
  const pending: PendingWithdrawal[] = []
  for (;;) {
    const page = await deps.pool.query<StoredWithdrawalRow>(
      `select d.document_id, d.source_uri, d.xml_uri, d.provider_json
        from legal_source_documents d
        left join legal_source_withdrawal_audits a
          on a.document_id = d.document_id and a.run_id = $1
        where d.provider_json->>'withdrawn' is null
        group by d.document_id
        having count(a.*) < case when d.xml_uri is null then 1 else 2 end
        order by d.document_id
        limit $2`,
      [deps.runId, deps.pageSize],
    )
    if (page.rows.length === 0) break
    for (const row of page.rows) {
      pending.push(await probeOne(deps, row))
    }
  }
  const confirmations = pending.filter(
    (entry) => entry.decision === 'mark_withdrawn',
  ).length
  if (shouldAbortWithdrawalRun(pending.length, confirmations)) {
    const limit = withdrawalConfirmationLimit(pending.length)
    report.checked = pending.length
    report.present = pending.filter(
      (entry) => entry.signal === 'present',
    ).length
    report.inconclusive = pending.filter(
      (entry) => entry.signal === 'inconclusive',
    ).length
    report.aborted = true
    report.abortReason = `suspected systemic change: ${confirmations} confirmations among ${pending.length} checked exceeds limit ${limit}; no documents marked, no index deletions attempted`
    return report
  }
  for (const entry of pending) {
    await applyOne(deps, entry, report)
  }
  return report
}

function readFlag(name: string) {
  return process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.slice(name.length + 3)
}

async function main() {
  const env = readLegalIngestorEnv()
  const runId =
    readFlag('run-id') ?? `withdrawal-${new Date().toISOString().slice(0, 10)}`
  const pool = new Pool({ connectionString: env.databaseUrl })
  const indexClient = createClient(
    env.meilisearchHost,
    env.meilisearchAdminApiKey,
  )
  const deps = createWithdrawalDeps(
    pool,
    env.mojFindCaseLawBaseUrl,
    runId,
    env.mojFindCaseLawRateLimit,
    (documentIds) =>
      deleteDocuments(indexClient, env.legalAuthoritiesIndex, documentIds).then(
        () => undefined,
      ),
    {
      ...(readFlag('gap-ms') ? { gapMs: Number(readFlag('gap-ms')) } : {}),
      ...(readFlag('limit') ? { pageSize: Number(readFlag('limit')) } : {}),
    },
  )
  const report = await runWithdrawalCheck(deps)
  await pool.end()
  console.info(JSON.stringify(report))
  if (report.aborted) {
    console.error(
      `WITHDRAWAL CHECK ABORTED (${report.runId}): ${report.abortReason} ` +
        `Checked=${report.checked}. No provider_json writes and no index ` +
        `deletions were made; investigate systemic change before re-running.`,
    )
    process.exitCode = 1
  }
  if (report.indexRemovalFailures.length > 0) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Withdrawal check failed',
    )
    process.exitCode = 1
  })
