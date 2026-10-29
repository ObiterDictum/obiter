import { Pool } from 'pg'
import { pathToFileURL } from 'node:url'
import { resolveProviderUrl } from '@obiter/legal-source-provider'
import {
  legislationBaseUrl,
  parseClmlDocument,
  parseYearFeed,
  provisionCountNote,
  sha256Hex,
  containerProvisionKinds,
  type IngestActRef,
  type IngestDocument,
  type LegislationProvisionKind,
} from './legislation-clml'
import {
  parseEffectsFeed,
  unappliedEffectsForProvision,
} from './legislation-effects'
import { withConcurrencyRetry } from './db-retry'

export const ingestUserAgent =
  'Obiter-Stage1-Ingest (research prototype; contact: admin@obiter.dev)'
export const settledRequestGapMs = 5000
const maxAttemptsPerRequest = 6
const backoffBaseMs = 5000
const maxBackoffMs = 5 * 60 * 1000
const scopeActType = 'ukpga'
export const scopeStartYear = 2020

export type LegislationDocOutcome =
  | {
      status: 'stored'
      identity: string
      provisions: number
      declaredProvisions: number | null
      p1Seen: number
      p1Rows: number
      p1BlockAmendment: number
      provisionCountNote: string | null
    }
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
  provisionCountMismatches: Array<{
    identity: string
    declaredProvisions: number | null
    p1Seen: number
    p1Rows: number
    p1BlockAmendment: number
    provisions: number
    note: string
  }>
}

export type Db = Pick<Pool, 'query' | 'connect'>

export interface LegislationIngestDeps {
  pool: Db
  gapMs: number
  skipEffects: boolean
  forceReparse: boolean
  maxActs?: number
  sleep: (ms: number) => Promise<void>
  fetchImpl: typeof fetch
}

export function isProvisionRow(kind: LegislationProvisionKind): boolean {
  return !containerProvisionKinds.has(kind)
}

export type EffectsWithheldMap = Map<string, boolean> | null

function hasUnappliedEffect(
  unappliedLabelPaths: Set<string>,
  labelPath: string,
): boolean {
  const effects = [...unappliedLabelPaths].map((path) => ({
    effectId: '',
    applied: false,
    type: '',
    affectedDisplay: '',
    affectingTitle: '',
    affected: [{ ref: '', labelPath: path, display: '' }],
  }))
  return unappliedEffectsForProvision(effects, labelPath).length > 0
}

export function withheldByLabelPath(
  doc: IngestDocument,
  unappliedLabelPaths: Set<string>,
): Map<string, boolean> {
  const map = new Map<string, boolean>()
  for (const provision of doc.provisions) {
    if (!isProvisionRow(provision.kind)) continue
    map.set(
      provision.labelPath,
      hasUnappliedEffect(unappliedLabelPaths, provision.labelPath),
    )
  }
  return map
}

export async function upsertLegislationDocument(
  pool: Db,
  doc: IngestDocument,
  effects: EffectsWithheldMap = null,
) {
  await withConcurrencyRetry(() => writeLegislationDocument(pool, doc, effects))
}

async function writeLegislationDocument(
  pool: Db,
  doc: IngestDocument,
  effects: EffectsWithheldMap,
) {
  const note = provisionCountNote(doc)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `insert into legislation_documents
      (identity, act_type, year, number, title, source_url, content_hash, extent, provision_count_note, acquired_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
     on conflict (identity) do update set
       title = excluded.title, source_url = excluded.source_url,
       content_hash = excluded.content_hash, extent = excluded.extent,
       provision_count_note = excluded.provision_count_note,
       acquired_at = now(),
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
        note ?? '',
      ],
    )
    const existing = await client.query<{
      label_path: string
      has_unapplied_effects: boolean
      effects_checked_at: string | null
    }>(
      `select label_path, has_unapplied_effects, effects_checked_at
         from legislation_provisions where document_identity = $1`,
      [doc.identity],
    )
    const oldFlags = new Map(
      existing.rows.map((row) => [row.label_path, row.has_unapplied_effects]),
    )
    const oldCheckedAt = new Map(
      existing.rows.map((row) => [row.label_path, row.effects_checked_at]),
    )
    await client.query(
      'delete from legislation_provisions where document_identity = $1',
      [doc.identity],
    )
    for (const provision of doc.provisions) {
      const oldFlag = oldFlags.get(provision.labelPath) ?? true
      const oldChecked = oldCheckedAt.get(provision.labelPath) ?? null
      const hasUnapplied = isProvisionRow(provision.kind)
        ? effects !== null
          ? (effects.get(provision.labelPath) ?? true)
          : oldChecked !== null
            ? oldFlag
            : true
        : false
      const effectsCheckedAt = effects !== null ? new Date() : oldChecked
      await client.query(
        `insert into legislation_provisions
        (id, document_identity, label_path, label, heading, parent_label_path,
         kind, extent, provision_text, own_text, source_hash, doc_order,
         has_unapplied_effects, effects_checked_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
       on conflict (id) do update set
         label_path = excluded.label_path, label = excluded.label,
         heading = excluded.heading,
         parent_label_path = excluded.parent_label_path,
         kind = excluded.kind,
         extent = excluded.extent, provision_text = excluded.provision_text,
         own_text = excluded.own_text,
         source_hash = excluded.source_hash, doc_order = excluded.doc_order,
         has_unapplied_effects = excluded.has_unapplied_effects,
         effects_checked_at = excluded.effects_checked_at,
         updated_at = now()`,
        [
          `${doc.identity}/${provision.labelPath}`,
          doc.identity,
          provision.labelPath,
          provision.label,
          provision.heading,
          provision.parentLabelPath,
          provision.kind,
          provision.extent,
          provision.text,
          provision.ownText,
          doc.contentHash,
          provision.docOrder,
          hasUnapplied,
          effectsCheckedAt,
        ],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Rollback failure must not mask the original write error.
    }
    throw error
  } finally {
    client.release()
  }
}

export async function readUnappliedEffects(
  deps: LegislationIngestDeps,
  doc: IngestDocument,
): Promise<Set<string> | null> {
  const maxEffectsPages = 100
  const base = `${legislationBaseUrl}/changes/affected/${doc.identity}/data.feed`
  let url: string | null = base
  const unappliedLabelPaths = new Set<string>()
  const seenUrls = new Set<string>()
  let pagesRead = 0
  while (url !== null) {
    if (pagesRead >= maxEffectsPages)
      throw new Error(
        `effects feed exceeded ${maxEffectsPages} pages (last: ${url})`,
      )
    if (seenUrls.has(url)) throw new Error(`effects feed cycled back to ${url}`)
    seenUrls.add(url)
    const response = await fetchPolitely(deps, url)
    if (response.status === 404 && pagesRead === 0) return null
    if (response.status === 404)
      throw new Error(
        `effects feed page ${pagesRead + 1} returned 404 (${url})`,
      )
    if (!response.ok)
      throw new Error(`effects feed returned ${response.status} (${url})`)
    const xml = await response.text()
    const parsed = parseEffectsFeed(xml, doc.identity)
    pagesRead += 1
    for (const effect of parsed.effects) {
      if (effect.applied) continue
      for (const ref of effect.affected) {
        if (ref.labelPath) unappliedLabelPaths.add(ref.labelPath)
      }
    }
    url = parsed.nextPageUrl
  }
  return unappliedLabelPaths
}

async function politeSleep(deps: LegislationIngestDeps) {
  await deps.sleep(deps.gapMs)
}

async function fetchPolitely(
  deps: LegislationIngestDeps,
  url: string,
): Promise<Response> {
  const target = resolveProviderUrl(legislationBaseUrl, url)
  if (!target) throw new Error(`refusing off-origin provider URL: ${url}`)
  let backoff = backoffBaseMs
  for (let attempt = 1; attempt <= maxAttemptsPerRequest; attempt += 1) {
    await politeSleep(deps)
    let response: Response
    try {
      response = await deps.fetchImpl(target, {
        headers: { 'User-Agent': ingestUserAgent },
        redirect: 'manual',
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

export async function readCrawlDelaySeconds(
  fetchImpl: typeof fetch,
): Promise<number | null> {
  const target = resolveProviderUrl(
    legislationBaseUrl,
    `${legislationBaseUrl}/robots.txt`,
  )
  if (!target) return null
  try {
    const response = await fetchImpl(target, {
      headers: { 'User-Agent': ingestUserAgent },
      redirect: 'manual',
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

async function refreshCountNote(pool: Db, identity: string, xml: string) {
  const [actType = '', yearText = '', numberText = ''] = identity.split('/')
  const parsed = parseClmlDocument(xml, {
    actType,
    year: Number(yearText),
    number: Number(numberText),
    title: identity,
  })
  if ('skipped' in parsed) return
  const note = provisionCountNote(parsed) ?? ''
  await pool.query(
    `update legislation_documents
        set provision_count_note = $2, updated_at = now()
      where identity = $1 and provision_count_note <> $2`,
    [identity, note],
  )
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
  if (stored.rows[0]?.content_hash === hash && !deps.forceReparse) {
    await refreshCountNote(deps.pool, identity, xml)
    return { status: 'skipped-unchanged', identity }
  }
  const parsed = parseClmlDocument(xml, ref)
  if ('skipped' in parsed) {
    return { status: 'skipped-no-fulltext', identity, reason: parsed.skipped }
  }
  let effects: EffectsWithheldMap = null
  if (!deps.skipEffects) {
    try {
      const unapplied = await readUnappliedEffects(deps, parsed)
      effects =
        unapplied === null ? null : withheldByLabelPath(parsed, unapplied)
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
  await upsertLegislationDocument(deps.pool, parsed, effects)
  return {
    status: 'stored',
    identity,
    provisions: parsed.provisions.length,
    declaredProvisions: parsed.declaredProvisions,
    p1Seen: parsed.p1Seen,
    p1Rows: parsed.p1Rows,
    p1BlockAmendment: parsed.p1BlockAmendment,
    provisionCountNote: provisionCountNote(parsed),
  }
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
    provisionCountMismatches: [],
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
  const deduped = acts.filter(
    (act, index) => index === 0 || acts[index - 1]!.number !== act.number,
  )
  report.actsListed = deduped.length
  let processed = 0
  for (const act of deduped) {
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
      if (outcome.provisionCountNote !== null) {
        report.provisionCountMismatches.push({
          identity: outcome.identity,
          declaredProvisions: outcome.declaredProvisions,
          p1Seen: outcome.p1Seen,
          p1Rows: outcome.p1Rows,
          p1BlockAmendment: outcome.p1BlockAmendment,
          provisions: outcome.provisions,
          note: outcome.provisionCountNote,
        })
      }
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
         failures_json = (
           select coalesce(jsonb_agg(elem order by ord), '[]'::jsonb)
           from (
             select elem, ord
             from jsonb_array_elements(
               coalesce(legislation_ingest_progress.failures_json, '[]'::jsonb)
               || excluded.failures_json
             ) with ordinality as t(elem, ord)
             order by ord desc limit 50
           ) tail
         ),
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

export const legislationIngestUsage = `Usage: bun run legislation:ingest [options] (from services/legal-ingestor)

Stage 1 legislation ingest: UK Public General Acts (ukpga) into Postgres
legislation_documents / legislation_provisions. Polite by construction:
one sequential loop honouring the site's Crawl-delay.

Options:
  --act=ukpga/YYYY/N   ingest a single Act (e.g. --act=ukpga/2023/29)
  --years=2020,2021    year scopes to ingest (default: 2020 through the current year)
  --max-acts=N         stop after N Acts per year (verification slices)
  --gap-ms=MS          ms between upstream requests (default 5000, never below Crawl-delay)
  --skip-effects       skip the affected-changes effects pass (bare or =1)
  --force-reparse      re-parse and re-store unchanged Acts too (bare or =1)
  -h, --help           print this usage and exit`

export interface LegislationIngestCliOptions {
  act: IngestActRef | null
  years: number[]
  gapMsRaw: string | undefined
  skipEffects: boolean
  forceReparse: boolean
  maxActs?: number
}

export type LegislationIngestCliParse =
  | { ok: true; help: false; options: LegislationIngestCliOptions }
  | { ok: true; help: true }
  | { ok: false; error: string }

function defaultScopeYears(): number[] {
  const current = new Date().getUTCFullYear()
  const years: number[] = []
  for (let year = scopeStartYear; year <= current; year += 1) years.push(year)
  return years
}

export function parseLegislationIngestArgs(
  argv: string[],
): LegislationIngestCliParse {
  const fail = (error: string): LegislationIngestCliParse => ({
    ok: false,
    error,
  })
  let help = false
  let actRaw: string | undefined
  let yearsRaw: string | undefined
  let gapMsRaw: string | undefined
  let skipEffects = false
  let forceReparse = false
  let maxActsRaw: string | undefined
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      help = true
      continue
    }
    if (arg === '--skip-effects') {
      skipEffects = true
      continue
    }
    if (arg === '--force-reparse') {
      forceReparse = true
      continue
    }
    const eq = arg.indexOf('=')
    const name = eq === -1 ? arg : arg.slice(0, eq)
    const value = eq === -1 ? undefined : arg.slice(eq + 1)
    switch (name) {
      case '--act':
      case '--years':
      case '--gap-ms':
      case '--max-acts': {
        if (value === undefined || value === '')
          return fail(`${name} needs a value (${name}=...)`)
        if (name === '--act') actRaw = value
        else if (name === '--years') yearsRaw = value
        else if (name === '--gap-ms') gapMsRaw = value
        else maxActsRaw = value
        break
      }
      case '--skip-effects': {
        if (value === '1' || value === 'true' || value === 'yes')
          skipEffects = true
        else if (value === '0' || value === 'false' || value === 'no')
          skipEffects = false
        else
          return fail(`--skip-effects takes no value, 1, or 0 (got ${value})`)
        break
      }
      case '--force-reparse': {
        if (value === '1' || value === 'true' || value === 'yes')
          forceReparse = true
        else if (value === '0' || value === 'false' || value === 'no')
          forceReparse = false
        else
          return fail(`--force-reparse takes no value, 1, or 0 (got ${value})`)
        break
      }
      default:
        return fail(
          arg.startsWith('-')
            ? `unrecognised flag ${arg}`
            : `unexpected argument ${arg}`,
        )
    }
  }
  if (help) return { ok: true, help: true }
  let act: IngestActRef | null = null
  if (actRaw !== undefined) {
    const match = actRaw.match(/^(ukpga)\/(\d{4})\/(\d+)$/i)
    if (!match) return fail('--act must look like ukpga/2010/15')
    act = {
      actType: match[1]!.toLowerCase(),
      year: Number(match[2]),
      number: Number(match[3]),
      title: actRaw,
    }
  }
  let years = defaultScopeYears()
  if (yearsRaw !== undefined) {
    years = yearsRaw.split(',').map((part) => Number(part.trim()))
    if (years.length === 0 || years.some((year) => !Number.isInteger(year))) {
      return fail(
        '--years must be a comma list of years (e.g. --years=2020,2021)',
      )
    }
  }
  let maxActs: number | undefined
  if (maxActsRaw !== undefined) {
    maxActs = Number(maxActsRaw)
    if (!Number.isInteger(maxActs) || maxActs < 1)
      return fail('--max-acts must be a positive integer')
  }
  return {
    ok: true,
    help: false,
    options: {
      act,
      years,
      gapMsRaw,
      skipEffects,
      forceReparse,
      ...(maxActs !== undefined ? { maxActs } : {}),
    },
  }
}

export function resolveRequestGapMs(
  raw: string | undefined,
  crawlDelaySeconds: number | null,
): number {
  const parsed = raw === undefined ? settledRequestGapMs : Number(raw)
  const requested = Number.isFinite(parsed) ? parsed : settledRequestGapMs
  return Math.max(requested, (crawlDelaySeconds ?? 5) * 1000)
}

async function main() {
  const parsed = parseLegislationIngestArgs(process.argv.slice(2))
  if (!parsed.ok) {
    console.error(parsed.error)
    console.error(legislationIngestUsage)
    process.exitCode = 2
    return
  }
  if (parsed.help) {
    console.info(legislationIngestUsage)
    return
  }
  const { readLegalIngestorEnv } = await import('./env.js')
  const env = readLegalIngestorEnv()
  const pool = new Pool({ connectionString: env.databaseUrl })
  const crawlDelay = await readCrawlDelaySeconds(fetch)
  const gapMs = resolveRequestGapMs(parsed.options.gapMsRaw, crawlDelay)
  console.info(
    JSON.stringify({
      robotsCrawlDelaySeconds: crawlDelay,
      requestGapMs: gapMs,
    }),
  )
  const deps: LegislationIngestDeps = {
    pool,
    gapMs,
    skipEffects: parsed.options.skipEffects,
    forceReparse: parsed.options.forceReparse,
    ...(parsed.options.maxActs !== undefined
      ? { maxActs: parsed.options.maxActs }
      : {}),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    fetchImpl: fetch,
  }
  const single = parsed.options.act
  if (single) {
    const outcome = await ingestOneAct(deps, single)
    console.info(JSON.stringify(outcome))
    await pool.end()
    if (outcome.status === 'failed') process.exitCode = 1
    return
  }
  const reports: LegislationScopeReport[] = []
  for (const year of parsed.options.years) {
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
