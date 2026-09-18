#!/usr/bin/env node
/*
 * Decompose the /api/search/fetch delta into the parts a runtime can and
 * cannot influence, with no HTTP server in the path.
 *
 * The first version of this probe measured the Meilisearch call, a
 * `select count(*)` and JSON.stringify, then attributed the ~180 ms
 * end-to-end search delta to "client-side runtime cost". Those three probes
 * account for only a few milliseconds, so the attribution was asserted rather
 * than shown. This version exercises the actual stored-search path the route
 * takes for a keyword query:
 *
 *   1. search() with the route's own pool options (limit 100, paragraphs, no
 *      snippets) — the Meilisearch engine call, identical service for both
 *      runtimes, so it isolates the engine;
 *   2. the withdrawn-check fan-out the route then runs: one
 *      legal_source_documents row (summary_json + document_json + provider_json)
 *      fetched per hit through the same pool, 100 concurrent via Promise.all,
 *      with the same Zod parse on the way out — the client-side share;
 *   3. the same fan-out sequentially, which separates per-call client cost
 *      from concurrency/pool scheduling;
 *   4. `select count(*)` and JSON.stringify as controls.
 *
 * The first Meilisearch call is reported separately as cold; the rest are warm.
 * Every figure is a p50 over its own loop, and the run is executed once per
 * runtime and repeated in alternating order by reproduce.sh, so engine and
 * host effects are visible across rounds rather than assumed away.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/bun-runtime-eval/decompose.mjs --runtime node --out /tmp/d-node.json
 *   /tmp/obiter-bun-eval/tools/bun-linux-x64/bun run scripts/bun-runtime-eval/decompose.mjs --runtime bun --out /tmp/d-bun.json
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
// Relative paths rather than workspace specifiers: the root package.json does
// not depend on these packages, so pnpm links them only inside services/api.
import { createClient, search } from '../../packages/search-client/src/index'
import { createPool } from '../../services/api/src/database'
import { readApiEnv } from '../../services/api/src/env'
import { createPostgresLegalAuthoritySourceStore } from '../../services/api/src/routes/legal-search/source-store'
import { readEnvAssignment } from '../load/target.mjs'

const WORKTREE = resolve(import.meta.dirname, '..', '..')
const SEARCH_QUERY = 'duty of care negligence'
const FANOUT_LOOPS = 15

function parseArgs(argv) {
  const out = { out: null, runtime: null }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') out.out = argv[++i]
    else if (argv[i] === '--runtime') out.runtime = argv[++i]
    else throw new Error(`unknown argument ${argv[i]}`)
  }
  if (!out.out) throw new Error('--out is required')
  return out
}

function summarise(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (fraction) =>
    Math.round(
      sorted[
        Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)
      ] * 100,
    ) / 100
  return {
    count: sorted.length,
    method: 'nearest-rank ceil(fraction*n)',
    p50: at(0.5),
    p95: at(0.95),
    min: Math.round(sorted[0] * 100) / 100,
    max: Math.round(sorted[sorted.length - 1] * 100) / 100,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const envText = await readFile(join(WORKTREE, '.env'), 'utf8')
  const databaseUrl = readEnvAssignment(envText, 'DATABASE_URL', process.env)
  if (!/obiter_bun_eval/.test(databaseUrl))
    throw new Error(
      'refusing to run against a database that is not this experiment’s',
    )

  const env = readApiEnv()
  const client = createClient(env.meilisearchHost, env.meilisearchSearchApiKey)
  const pool = createPool({ ...env, databaseUrl })
  const store = createPostgresLegalAuthoritySourceStore(pool)

  const report = {
    runtime:
      args.runtime ??
      (typeof Bun === 'undefined'
        ? `node ${process.version}`
        : `bun ${Bun.version}`),
    engine: {
      host: env.meilisearchHost,
      index: env.legalAuthoritiesIndex,
      // The single Meilisearch service is shared by both runtimes; naming it
      // here is what lets a reader see an engine change between rounds.
      shared: true,
    },
    query: SEARCH_QUERY,
    fanoutLoops: FANOUT_LOOPS,
  }

  // 1. The engine call the route makes to build its 100-hit pool, with the
  //    route's own options. Cold (first call) and warm are separated because
  //    Meilisearch may cache the first query.
  const poolOptions = {
    includeSnippets: false,
    includeParagraphs: true,
    limit: 100,
  }
  const coldStarted = performance.now()
  const poolFetch = await search(
    client,
    env.legalAuthoritiesIndex,
    SEARCH_QUERY,
    {},
    poolOptions,
  )
  report.meilisearchPoolFetchColdMs =
    Math.round((performance.now() - coldStarted) * 100) / 100
  report.meilisearchPoolFetchColdProcessingMs =
    poolFetch?.processingTimeMs ?? null
  report.poolHits = poolFetch?.hits?.length ?? null
  const hitIds = (poolFetch?.hits ?? []).map((hit) => hit.id)

  // The engine's own processingTimeMs separates Meilisearch service time from
  // the client-side HTTP + JSON-parse cost that `search()` also includes.
  const searchTimes = []
  const engineTimes = []
  for (let i = 0; i < 10; i += 1) {
    const started = performance.now()
    const result = await search(
      client,
      env.legalAuthoritiesIndex,
      SEARCH_QUERY,
      {},
      poolOptions,
    )
    searchTimes.push(performance.now() - started)
    if (Number.isFinite(result?.processingTimeMs))
      engineTimes.push(result.processingTimeMs)
  }
  report.meilisearchPoolFetchWarm = summarise(searchTimes)
  report.meilisearchEngineWarm = summarise(engineTimes)

  // The shared engine's version, so a round where the engine changed is
  // visible in the artifact rather than assumed constant. `/version` requires
  // the search key on this instance, so go through the product's own client.
  report.meilisearchVersion = await client
    .getVersion()
    .then((version) => version?.pkgVersion ?? null)
    .catch(() => null)

  // 2. The withdrawn-check fan-out, exactly as the route runs it: one row per
  //    hit through the pool, all concurrent, Zod parse included.
  const fanoutTimes = []
  let fanoutRows = 0
  let fanoutWithdrawn = 0
  for (let i = 0; i < FANOUT_LOOPS; i += 1) {
    const started = performance.now()
    const records = await Promise.all(hitIds.map((id) => store.get(id)))
    fanoutTimes.push(performance.now() - started)
    fanoutRows = records.length
    fanoutWithdrawn = records.filter((record) => record?.withdrawn).length
  }
  report.fanoutRows = fanoutRows
  report.fanoutWithdrawn = fanoutWithdrawn
  report.storeFanoutConcurrent = summarise(fanoutTimes)

  // 3. The same fan-out one call at a time, which removes concurrency and pool
  //    scheduling from the comparison and leaves per-call client cost.
  if (hitIds.length > 0) {
    const sequentialTimes = []
    for (let i = 0; i < FANOUT_LOOPS; i += 1) {
      const started = performance.now()
      for (const id of hitIds) await store.get(id)
      sequentialTimes.push(performance.now() - started)
    }
    report.storeFanoutSequential = summarise(sequentialTimes)
  }

  // 4. Controls: a trivial Postgres round-trip and JSON serialisation of a
  //    realistic payload.
  const pgTimes = []
  for (let i = 0; i < 30; i += 1) {
    const started = performance.now()
    const result = await pool.query(
      'select count(*)::int as count from matters',
    )
    pgTimes.push(performance.now() - started)
    if (i === 0) report.matterRows = result.rows[0]?.count ?? null
  }
  report.postgresCount = summarise(pgTimes)

  const payload = {
    matters: Array.from({ length: 40 }, (_, index) => ({
      id: `mtr_${index}`,
      name: `Matter ${index} — boundary dispute`,
      primaryJurisdiction: 'england_and_wales',
      createdAt: new Date().toISOString(),
    })),
  }
  const jsonTimes = []
  for (let i = 0; i < 200; i += 1) {
    const started = performance.now()
    JSON.stringify(payload)
    jsonTimes.push(performance.now() - started)
  }
  report.jsonStringify = summarise(jsonTimes)

  await pool.end()
  await writeFile(args.out, JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify(report, null, 2))
}

await main()
