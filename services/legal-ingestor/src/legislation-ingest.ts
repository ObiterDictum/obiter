import { Pool } from 'pg'
import { pathToFileURL } from 'node:url'
import {
  legislationBaseUrl,
  parseClmlDocument,
  parseYearFeed,
  sha256Hex,
  type IngestActRef,
  type IngestDocument,
} from './legislation-clml'
import {
  parseEffectsFeed,
  unappliedEffectsForProvision,
} from './legislation-effects'

/**
 * Stage 1 legislation ingest: UK Public General Acts into Postgres
 * `legislation_documents` / `legislation_provisions` only. This module never
 * touches Meilisearch: `rebuild-legislation-index.ts` in services/api derives
 * the legislation_provisions index from these rows afterwards, so there is
 * exactly one writer to the derived index (the second-writer defect the
 * judgment pipeline already fixed once).
 *
 * Source is the CLML `data.xml` for each Act, not `data.akn`. The XML
 * response declares its contract inline (`xsi:schemaLocation` pointing at
 * the published legislation.xsd), and every addressable provision carries a
 * stable version-neutral `/id/` URI plus RestrictExtent metadata as
 * attributes. The AKN rendition is offered without that documented identity
 * and extent surface, so reading it would mean re-deriving what CLML states.
 *
 * Polite by construction: one sequential loop, a fixed gap honouring the
 * site's `Crawl-delay: 5` (robots.txt is re-fetched at the start of every
 * run and the gap only ever grows towards it, never below 5s), a contact
 * user agent, and exponential backoff on 429/503/5xx. The published
 * 1500-requests-per-5-minutes figure is an abuse ceiling, not a target: at
 * 5s spacing a full ~200-Act scope plus year feeds and effects pages lands
 * in the low hundreds of requests over several hours, two orders of
 * magnitude under it.
 *
 * Resumable per Act: `legislation_ingest_progress` records the last
 * completed Act number per year scope, and provision writes are idempotent
 * on the document content hash, so a re-run skips already-stored Acts
 * without re-fetching their bodies.
 *
 * Size note: this stays one orchestration module (~450 lines, over the 300
 * target) on purpose. Politeness, effects paging, per-act progress, and the
 * entrypoint share one deps/flush shape with a single caller; splitting
 * would scatter that state across modules for no reuse. The pure CLML
 * parse already lives separately in legislation-clml.ts.
 */

export const ingestUserAgent =
  'Obiter-Stage1-Ingest (research prototype; contact: admin@obiter.dev)'
/** Floor: the site's Crawl-delay is 5, so this never goes below it. */
export const settledRequestGapMs = 5000
const maxAttemptsPerRequest = 6
const backoffBaseMs = 5000
const maxBackoffMs = 5 * 60 * 1000
const scopeActType = 'ukpga'
/** Earliest year in Stage 1 scope; secondary legislation is not scope. */
export const scopeStartYear = 2020

export type LegislationDocOutcome =
  | { status: 'stored'; identity: string; provisions: number }
  | { status: 'skipped-unchanged'; identity: string }
  | { status: 'skipped-no-fulltext'; identity: string; reason: string }
  | { status: 'failed'; identity: string; reason: string }

export interface LegislationScopeReport {
  scopeKey: string
  year: number
  actsListed: number
  stored: number
  provisionsStored: number
  skippedUnchanged: number
  skippedNoFulltext: number
  failed: number
  failures: Array<{ identity: string; reason: string }>
}

export type Db = Pick<Pool, 'query'>

export interface LegislationIngestDeps {
  pool: Db
  gapMs: number
  skipEffects: boolean
  maxActs?: number
  sleep: (ms: number) => Promise<void>
  fetchImpl: typeof fetch
}

async function upsertLegislationDocument(pool: Db, doc: IngestDocument) {
  await pool.query(
    `insert into legislation_documents
      (identity, act_type, year, number, title, source_url, content_hash, extent, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now())
     on conflict (identity) do update set
       title = excluded.title, source_url = excluded.source_url,
       content_hash = excluded.content_hash, extent = excluded.extent,
       updated_at = now()`,
    [
      doc.identity,
      doc.actType,
      doc.year,
      doc.number,
      doc.title,
      doc.sourceUrl,
      doc.contentHash,
      doc.extent,
    ],
  )
  await pool.query(
    'delete from legislation_provisions where document_identity = $1',
    [doc.identity],
  )
  for (const provision of doc.provisions) {
    await pool.query(
      `insert into legislation_provisions
        (id, document_identity, label_path, label, extent, provision_text, source_hash, doc_order, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now())
       on conflict (id) do update set
         label_path = excluded.label_path, label = excluded.label,
         extent = excluded.extent, provision_text = excluded.provision_text,
         source_hash = excluded.source_hash, doc_order = excluded.doc_order,
         updated_at = now()`,
      [
        `${doc.identity}/${provision.labelPath}`,
        doc.identity,
        provision.labelPath,
        provision.label,
        provision.extent,
        provision.text,
        doc.contentHash,
        provision.docOrder,
      ],
    )
  }
}

async function markProvisionEffects(
  pool: Db,
  identity: string,
  labelPath: string,
  hasUnapplied: boolean,
) {
  await pool.query(
    `update legislation_provisions
       set has_unapplied_effects = $3, effects_checked_at = now()
     where document_identity = $1 and label_path = $2`,
    [identity, labelPath, hasUnapplied],
  )
}

async function clearProvisionEffects(pool: Db, identity: string) {
  await pool.query(
    `update legislation_provisions
       set has_unapplied_effects = false, effects_checked_at = now()
     where document_identity = $1`,
    [identity],
  )
}

async function politeSleep(deps: LegislationIngestDeps) {
  await deps.sleep(deps.gapMs)
}

async function fetchPolitely(
  deps: LegislationIngestDeps,
  url: string,
): Promise<Response> {
  let backoff = backoffBaseMs
  for (let attempt = 1; attempt <= maxAttemptsPerRequest; attempt += 1) {
    await politeSleep(deps)
    let response: Response
    try {
      response = await deps.fetchImpl(url, {
        headers: { 'User-Agent': ingestUserAgent },
      })
    } catch (error) {
      if (attempt === maxAttemptsPerRequest) throw error
      await deps.sleep(backoff)
      backoff = Math.min(backoff * 2, maxBackoffMs)
      continue
    }
    if (
      response.status === 429 ||
      response.status === 503 ||
      response.status >= 500
    ) {
      const retryAfter = response.headers.get('retry-after')
      const retryMs = retryAfter
        ? Math.min(Number(retryAfter) * 1000 || backoff, maxBackoffMs)
        : backoff
      if (attempt === maxAttemptsPerRequest) {
        throw new Error(
          `GET ${url} returned ${response.status} after ${maxAttemptsPerRequest} attempts`,
        )
      }
      await deps.sleep(retryMs)
      backoff = Math.min(backoff * 2, maxBackoffMs)
      continue
    }
    return response
  }
  throw new Error(`GET ${url} exhausted retries`)
}

/** Re-read robots.txt every run; the gap only grows towards Crawl-delay. */
export async function readCrawlDelaySeconds(
  fetchImpl: typeof fetch,
): Promise<number | null> {
  try {
    const response = await fetchImpl(`${legislationBaseUrl}/robots.txt`, {
      headers: { 'User-Agent': ingestUserAgent },
    })
    if (!response.ok) return null
    const body = await response.text()
    let appliesToAll = false
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (/^user-agent:\s*\*/i.test(trimmed)) appliesToAll = true
      else if (/^user-agent:/i.test(trimmed)) appliesToAll = false
      else if (appliesToAll) {
        const match = trimmed.match(/^crawl-delay:\s*(\d+)/i)
        if (match) return Number(match[1])
      }
    }
    return null
  } catch {
    return null
  }
}

/** Pages the whole affected-changes feed and flags amended provisions. */
export async function ingestEffectsForDocument(
  deps: LegislationIngestDeps,
  doc: IngestDocument,
): Promise<{ checked: number; amended: number }> {
  const base = `${legislationBaseUrl}/changes/affected/${doc.identity}/data.feed`
  let url: string | null = base
  const unappliedLabelPaths = new Set<string>()
  while (url !== null) {
    const response = await fetchPolitely(deps, url)
    if (response.status === 404) break
    if (!response.ok)
      throw new Error(`effects feed returned ${response.status}`)
    const xml = await response.text()
    const parsed = parseEffectsFeed(xml, doc.identity)
    for (const effect of parsed.effects) {
      if (effect.applied) continue
      for (const ref of effect.affected) {
        if (ref.labelPath) unappliedLabelPaths.add(ref.labelPath)
      }
    }
    url = parsed.nextPageUrl
  }
  await clearProvisionEffects(deps.pool, doc.identity)
  let amended = 0
  for (const provision of doc.provisions) {
    const hits = unappliedEffectsForProvision(
      // Re-expand: match() needs full effects; unapplied set alone cannot do
      // the bidirectional ancestor check. Recompute from stored paths.
      [...unappliedLabelPaths].map((labelPath) => ({
        effectId: '',
        applied: false,
        type: '',
        affectedDisplay: '',
        affectingTitle: '',
        affected: [{ ref: '', labelPath, display: '' }],
      })),
      provision.labelPath,
    )
    const hasUnapplied = hits.length > 0
    if (hasUnapplied) amended += 1
    await markProvisionEffects(
      deps.pool,
      doc.identity,
      provision.labelPath,
      hasUnapplied,
    )
  }
  return { checked: doc.provisions.length, amended }
}

export async function ingestOneAct(
  deps: LegislationIngestDeps,
  ref: IngestActRef,
): Promise<LegislationDocOutcome> {
  const identity = `${ref.actType}/${ref.year}/${ref.number}`
  const stored = await deps.pool.query<{ content_hash: string }>(
    'select content_hash from legislation_documents where identity = $1',
    [identity],
  )
  const dataUrl = `${legislationBaseUrl}/${identity}/data.xml`
  let response: Response
  try {
    response = await fetchPolitely(deps, dataUrl)
  } catch (error) {
    return {
      status: 'failed',
      identity,
      reason: error instanceof Error ? error.message : 'fetch failed',
    }
  }
  if (response.status === 404) {
    return {
      status: 'skipped-no-fulltext',
      identity,
      reason: 'no data.xml upstream (404)',
    }
  }
  if (!response.ok) {
    return {
      status: 'failed',
      identity,
      reason: `data.xml returned ${response.status}`,
    }
  }
  const xml = await response.text()
  if (!xml.includes('<Legislation')) {
    return {
      status: 'skipped-no-fulltext',
      identity,
      reason: 'data.xml is not a CLML document',
    }
  }
  const hash = sha256Hex(xml)
  if (stored.rows[0]?.content_hash === hash) {
    return { status: 'skipped-unchanged', identity }
  }
  const parsed = parseClmlDocument(xml, ref)
  if ('skipped' in parsed) {
    return { status: 'skipped-no-fulltext', identity, reason: parsed.skipped }
  }
  await upsertLegislationDocument(deps.pool, parsed)
  if (!deps.skipEffects) {
    try {
      await ingestEffectsForDocument(deps, parsed)
    } catch (error) {
      return {
        status: 'failed',
        identity,
        reason:
          error instanceof Error
            ? `effects pass failed: ${error.message}`
            : 'effects pass failed',
      }
    }
  }
  return { status: 'stored', identity, provisions: parsed.provisions.length }
}

export function nextFeedPageUrl(xml: string): string | null {
  const nextAttrs = Array.from(xml.matchAll(/<link\b([^>]*)\/>/gi))
    .map((match: RegExpMatchArray) => match[1] ?? '')
    .find((attrs: string) => attrs.includes('rel="next"'))
  const href = nextAttrs?.match(/href="([^"]*)"/i)?.[1] ?? null
  return href ? href.replace(/&amp;/g, '&') : null
}

function buildScopeKey(year: number) {
  return `${scopeActType}|${year}`
}

export async function ingestYear(
  deps: LegislationIngestDeps,
  year: number,
): Promise<LegislationScopeReport> {
  const scopeKey = buildScopeKey(year)
  const report: LegislationScopeReport = {
    scopeKey,
    year,
    actsListed: 0,
    stored: 0,
    provisionsStored: 0,
    skippedUnchanged: 0,
    skippedNoFulltext: 0,
    failed: 0,
    failures: [],
  }
  const feedResponse = await fetchPolitely(
    deps,
    `${legislationBaseUrl}/${scopeActType}/${year}/data.feed`,
  )
  if (!feedResponse.ok) {
    report.failures.push({
      identity: `${scopeActType}/${year}`,
      reason: `year feed returned ${feedResponse.status}`,
    })
    report.failed += 1
    return report
  }
  // Year feeds page at 20 entries: follow rel=next until it runs out, or
  // low-numbered Acts silently fall out of scope (2020 lists 29 over two
  // pages; page 1 alone ends at c.10).
  const acts: IngestActRef[] = []
  const firstPageXml = await feedResponse.text()
  acts.push(...parseYearFeed(firstPageXml, year))
  let feedUrl: string | null = nextFeedPageUrl(firstPageXml)
  while (feedUrl !== null) {
    const pageResponse = await fetchPolitely(deps, feedUrl)
    if (!pageResponse.ok) {
      report.failures.push({
        identity: `${scopeActType}/${year}`,
        reason: `year feed page returned ${pageResponse.status}`,
      })
      report.failed += 1
      return report
    }
    const pageXml = await pageResponse.text()
    acts.push(...parseYearFeed(pageXml, year))
    feedUrl = nextFeedPageUrl(pageXml)
  }
  acts.sort((a, b) => a.number - b.number)
  report.actsListed = acts.length
  // Resume on stored rows, not on the number cursor: a scope whose listing
  // grew (year-feed paging was added mid-campaign) must still pick up Acts
  // below the cursor. ingestOneAct stays hash-idempotent underneath.
  const stored = await deps.pool.query<{ number: number }>(
    'select number from legislation_documents where act_type = $1 and year = $2',
    [scopeActType, year],
  )
  const storedNumbers = new Set(stored.rows.map((row) => row.number))
  let processed = 0
  for (const act of acts) {
    if (storedNumbers.has(act.number)) continue
    if (deps.maxActs !== undefined && processed >= deps.maxActs) break
    let outcome: LegislationDocOutcome
    try {
      outcome = await ingestOneAct(deps, act)
    } catch (error) {
      outcome = {
        status: 'failed',
        identity: `${act.actType}/${act.year}/${act.number}`,
        reason: error instanceof Error ? error.message : 'ingest threw',
      }
    }
    if (outcome.status === 'stored') {
      report.stored += 1
      report.provisionsStored += outcome.provisions
    } else if (outcome.status === 'skipped-unchanged') {
      report.skippedUnchanged += 1
    } else if (outcome.status === 'skipped-no-fulltext') {
      report.skippedNoFulltext += 1
    } else {
      report.failed += 1
      report.failures.push({
        identity: outcome.identity,
        reason: outcome.reason,
      })
    }
    processed += 1
    await deps.pool.query(
      `insert into legislation_ingest_progress
        (scope_key, act_type, year, last_completed_number, stored_count,
         skipped_unchanged_count, skipped_no_fulltext_count, failed_count, failures_json, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())
       on conflict (scope_key) do update set
         last_completed_number = excluded.last_completed_number,
         stored_count = legislation_ingest_progress.stored_count + excluded.stored_count,
         skipped_unchanged_count = legislation_ingest_progress.skipped_unchanged_count + excluded.skipped_unchanged_count,
         skipped_no_fulltext_count = legislation_ingest_progress.skipped_no_fulltext_count + excluded.skipped_no_fulltext_count,
         failed_count = legislation_ingest_progress.failed_count + excluded.failed_count,
         failures_json = excluded.failures_json,
         updated_at = now()`,
      [
        scopeKey,
        scopeActType,
        year,
        act.number,
        outcome.status === 'stored' ? 1 : 0,
        outcome.status === 'skipped-unchanged' ? 1 : 0,
        outcome.status === 'skipped-no-fulltext' ? 1 : 0,
        outcome.status === 'failed' ? 1 : 0,
        JSON.stringify(
          outcome.status === 'failed' ||
            outcome.status === 'skipped-no-fulltext'
            ? [{ identity: outcome.identity, reason: outcome.reason }]
            : [],
        ),
      ],
    )
  }
  return report
}

function readFlag(name: string) {
  return process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.slice(name.length + 3)
}

function readYears(): number[] {
  const raw = readFlag('years')
  if (!raw) {
    const current = new Date().getUTCFullYear()
    const years: number[] = []
    for (let year = scopeStartYear; year <= current; year += 1) years.push(year)
    return years
  }
  return raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((year) => Number.isInteger(year))
}

async function main() {
  const { readLegalIngestorEnv } = await import('./env.js')
  const env = readLegalIngestorEnv()
  const pool = new Pool({ connectionString: env.databaseUrl })
  const crawlDelay = await readCrawlDelaySeconds(fetch)
  const gapMs = Math.max(
    Number(readFlag('gap-ms') ?? settledRequestGapMs),
    (crawlDelay ?? 5) * 1000,
  )
  console.info(
    JSON.stringify({
      robotsCrawlDelaySeconds: crawlDelay,
      requestGapMs: gapMs,
    }),
  )
  const deps: LegislationIngestDeps = {
    pool,
    gapMs,
    skipEffects: readFlag('skip-effects') === '1',
    ...(readFlag('max-acts') ? { maxActs: Number(readFlag('max-acts')) } : {}),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    fetchImpl: fetch,
  }
  const single = readFlag('act')
  if (single) {
    const match = single.match(/^(ukpga)\/(\d{4})\/(\d+)$/i)
    if (!match) throw new Error('--act must look like ukpga/2010/15')
    const outcome = await ingestOneAct(deps, {
      actType: match[1]!.toLowerCase(),
      year: Number(match[2]),
      number: Number(match[3]),
      title: single,
    })
    console.info(JSON.stringify(outcome))
    await pool.end()
    if (outcome.status === 'failed') process.exitCode = 1
    return
  }
  const reports: LegislationScopeReport[] = []
  for (const year of readYears()) {
    const report = await ingestYear(deps, year)
    reports.push(report)
    console.info(JSON.stringify(report))
  }
  await pool.end()
  const failed = reports.reduce((sum, report) => sum + report.failed, 0)
  const stored = reports.reduce((sum, report) => sum + report.stored, 0)
  console.info(JSON.stringify({ years: reports.length, stored, failed }))
  if (failed > 0) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Legislation ingest failed',
    )
    process.exitCode = 1
  })
