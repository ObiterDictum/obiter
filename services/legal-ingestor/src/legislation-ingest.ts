import { Pool } from 'pg'
import { pathToFileURL } from 'node:url'
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
 * completed Act number per year scope. Re-runs re-fetch every listed Act's
 * data.xml and compare the content hash: unchanged Acts report
 * skipped-unchanged without re-parsing, changed Acts re-store. Nothing is
 * skipped on stored row presence alone, so updates are picked up.
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
  /** Stored documents whose P1 extraction diverged from the declared
   * count. A gap fully explained by BlockAmendment inserts is healthy
   * and never lands here; the list exists so a systematic unexplained
   * gap shows as a pattern across a year. */
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
  /** Re-parse and re-store even when the content hash is unchanged. The
   * forced path goes through the same effects pass as a changed Act, so
   * withheld flags survive the row rewrite. Verification/rescue runs only. */
  forceReparse: boolean
  maxActs?: number
  sleep: (ms: number) => Promise<void>
  fetchImpl: typeof fetch
}

/** Effects are per-provision state. Container rows (Part, Chapter, Schedule,
 * crossheading) are headings: never withheld, never flagged, excluded from
 * the effects pass, so banner counts stay honest and their always-visible
 * identity does not depend on feed state. Kinds are shared from
 * legislation-clml.ts rather than re-listed here. */
export function isProvisionRow(kind: LegislationProvisionKind): boolean {
  return !containerProvisionKinds.has(kind)
}

/** Withheld/due state for a document's provision rows, computed from a
 * successfully read effects feed (label path -> has-unapplied), or null
 * when the feed could not be read. Null is "no information", never "no
 * effects": the replacement then preserves known-good flags and defaults
 * new rows to withheld, so text can only ever move towards
 * amended-not-held, never towards servable. */
export type EffectsWithheldMap = Map<string, boolean> | null

/** Whether a provision carries an unapplied effect. Matching is
 * bidirectional (an amendment to s. 13 makes s. 13(2) stale, and an
 * amendment to s. 13(2)(a) makes the served s. 13 text stale), so it
 * recomputes from full effect references rather than testing the unapplied
 * set for the exact path. */
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

/** Withheld flag per provision row, from a successfully read effects feed. */
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
  // One transaction: a crash between the document row and its provisions
  // must never leave a document with half its provisions (or none, after
  // the delete). Pool.query would spread these across connections, so
  // checkout one client for the whole BEGIN/COMMIT.
  // The extraction-completeness note persists on the row (never a separate
  // lookup): a mismatch stores flagged, it never fails the document, so
  // the flag is what makes that decision auditable per Act.
  const note = provisionCountNote(doc)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `insert into legislation_documents
      (identity, act_type, year, number, title, source_url, content_hash, extent, provision_count_note, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     on conflict (identity) do update set
       title = excluded.title, source_url = excluded.source_url,
       content_hash = excluded.content_hash, extent = excluded.extent,
       provision_count_note = excluded.provision_count_note,
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
    // The rewrite deletes and recreates every row, so the effects flags
    // must come from the staged effects pass, never from the column
    // default (migration default is false): without a successful read,
    // matching label paths keep their flag only when it carries a check
    // timestamp, otherwise the row withholds (fail-closed).
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
      // Three decision branches, matched on effects availability so no
      // non-null assertion is needed: checked read wins; otherwise a
      // provision keeps its known-good flag only when that flag came from
      // a real check (non-null timestamp) — a legacy default-false row
      // with no check never stays servable, it withholds. New rows
      // withhold too.
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
        (id, document_identity, label_path, label, parent_label_path, kind,
         extent, provision_text, source_hash, doc_order,
         has_unapplied_effects, effects_checked_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
       on conflict (id) do update set
         label_path = excluded.label_path, label = excluded.label,
         parent_label_path = excluded.parent_label_path,
         kind = excluded.kind,
         extent = excluded.extent, provision_text = excluded.provision_text,
         source_hash = excluded.source_hash, doc_order = excluded.doc_order,
         has_unapplied_effects = excluded.has_unapplied_effects,
         effects_checked_at = excluded.effects_checked_at,
         updated_at = now()`,
        [
          `${doc.identity}/${provision.labelPath}`,
          doc.identity,
          provision.labelPath,
          provision.label,
          provision.parentLabelPath,
          provision.kind,
          provision.extent,
          provision.text,
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

/** Pages the whole affected-changes feed and returns the set of provision
 * label paths carrying at least one unapplied effect. Returns null ONLY
 * when the FIRST page is a 404: the feed is absent, "no information", not
 * "no effects" — the caller preserves known-good flags instead of clearing
 * them.
 *
 * Every other pagination outcome throws, so the caller aborts before
 * replacing any rows. A later-page 404, any non-OK page, a cycling feed,
 * or a feed longer than the 100-page cap would each yield a PARTIAL effect
 * set, and a partial set clears the flag on every provision whose effects
 * live on an unread page. Fail-closed is no writes, never a partial read
 * treated as complete.
 *
 * Paging is capped at 100 pages (50 results each) as a cycle guard: the
 * feed is finite, an uncapped `rel=next` walk would loop forever on a
 * cycling server, and reaching the cap aborts instead of truncating.
 *
 * The feed has NO server-side provision filter: a query param naming a
 * provision (e.g. `data.feed?affected-provision=s.40`) is silently ignored
 * and the whole-Act feed returns, so 16 whole-Act effects were once misread
 * as one section's. Never add a filter param here; page the whole feed and
 * scope client-side on ukm:AffectedProvisions/ukm:Section URIs, which is
 * what makes the flags honest. Same whole-Act trap as the HTML
 * yet-to-be-applied heading one layer down, which is why neither is read. */
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
    // A cycling feed re-issues a page it already read (next round-trips
    // to an earlier URL): without this guard it walks to the cap and the
    // guard would otherwise misread the resulting partial set as complete.
    if (seenUrls.has(url)) throw new Error(`effects feed cycled back to ${url}`)
    seenUrls.add(url)
    const response = await fetchPolitely(deps, url)
    // Only the first 404 means "no feed". A later-page 404 is a partial
    // read: aborting beats clearing flags from a truncated walk.
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

/**
 * Re-derives the extraction-completeness note from an unchanged Act's
 * re-fetched body and updates the row only when the note moved. Never
 * touches provisions and never fails the Act: an unparseable re-fetch of
 * unchanged content leaves the stored note alone.
 */
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
    // Content unchanged: provisions stay untouched, but the
    // extraction-completeness note is re-derived from the re-fetched
    // body. The count check changed (BlockAmendment-explained gaps went
    // quiet), and without this refresh a stale loud note from the old
    // check would sit on a healthy document forever. A forced re-parse
    // (parser change under test) bypasses this branch and re-stores,
    // going through the same effects pass as a changed Act so the
    // withheld flags survive the row rewrite.
    await refreshCountNote(deps.pool, identity, xml)
    return { status: 'skipped-unchanged', identity }
  }
  const parsed = parseClmlDocument(xml, ref)
  if ('skipped' in parsed) {
    return { status: 'skipped-no-fulltext', identity, reason: parsed.skipped }
  }
  // Effects before rows: the replacement deletes and recreates every
  // provision row, so a row must never land servable before its effects
  // state is known. A failed feed aborts before any write (old rows and
  // known-good flags stay intact); an unreadable feed (404 is "no
  // information", not "no effects") preserves old flags and defaults new
  // rows to withheld — text can only move towards amended-not-held.
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
  // Year feeds should not repeat an Act across pages, but dedupe anyway so
  // a repeated entry re-validates by hash instead of ingesting twice.
  const deduped = acts.filter(
    (act, index) => index === 0 || acts[index - 1]!.number !== act.number,
  )
  report.actsListed = deduped.length
  // No stored-number skip: every listed Act is re-fetched and compared on
  // content hash inside ingestOneAct (unchanged reports skipped-unchanged
  // without re-parsing, changed re-stores). Skipping on row presence alone
  // is what made year re-runs dead to updates.
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

export const legislationIngestUsage = `Usage: pnpm legislation:ingest [options] (from services/legal-ingestor)

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

/**
 * Pure argv parse so --help and bad flags never reach env, network, or
 * the database. Unknown flags and positionals fail rather than being
 * silently ignored (a bare --skip-effects once ran the full effects
 * pass because only --skip-effects=1 was read).
 */
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

/** Request gap with a finite-number guard: a non-numeric --gap-ms falls
 * back to the 5s floor instead of propagating NaN into the sleep loop. */
export function resolveRequestGapMs(
  raw: string | undefined,
  crawlDelaySeconds: number | null,
): number {
  const parsed = raw === undefined ? settledRequestGapMs : Number(raw)
  const requested = Number.isFinite(parsed) ? parsed : settledRequestGapMs
  return Math.max(requested, (crawlDelaySeconds ?? 5) * 1000)
}

async function main() {
  // Parse before env, pool, or network: --help must print usage and
  // exit with no DATABASE_URL, no database, and no upstream contact.
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
