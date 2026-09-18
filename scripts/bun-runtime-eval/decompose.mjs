#!/usr/bin/env node
/*
 * Decompose the runtime delta: how much of a journey's time is the inbound HTTP
 * server, and how much is the outbound work both runtimes do identically
 * (Meilisearch over the search client, Postgres over node-postgres).
 *
 * Runs the same loops under Node and under Bun with no HTTP server in the path,
 * so a difference here is client-side runtime cost, not the server.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/bun-runtime-eval/decompose.mjs --out /tmp/d-node.json
 *   /tmp/obiter-bun-eval/tools/bun-linux-x64/bun run scripts/bun-runtime-eval/decompose.mjs --out /tmp/d-bun.json
 */
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
// Relative paths rather than workspace specifiers: the root package.json does
// not depend on these packages, so pnpm links them only inside services/api.
import { createClient, search } from '../../packages/search-client/src/index'
import { createPool } from '../../services/api/src/database'
import { readApiEnv } from '../../services/api/src/env'
import { readEnvAssignment } from '../load/target.mjs'

const WORKTREE = resolve(import.meta.dirname, '..', '..')

function parseArgs(argv) {
  const out = { out: null }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') out.out = argv[++i]
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

  const report = {
    runtime:
      typeof Bun === 'undefined'
        ? `node ${process.version}`
        : `bun ${Bun.version}`,
    samples: 30,
  }

  // Outbound Meilisearch through the product's own search client.
  const searchTimes = []
  for (let i = 0; i < 30; i += 1) {
    const started = performance.now()
    const result = await search(
      client,
      env.legalAuthoritiesIndex,
      'duty of care negligence',
      {},
      { limit: 20 },
    )
    searchTimes.push(performance.now() - started)
    if (i === 0) report.searchHits = result?.hits?.length ?? null
  }
  report.meilisearchSearch = summarise(searchTimes)

  // Outbound Postgres through the same pool and the same kind of query the
  // authenticated list routes run.
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

  // JSON serialisation of a realistic payload, which is what the server does
  // with every response body.
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
  const { writeFile } = await import('node:fs/promises')
  await writeFile(args.out, JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify(report, null, 2))
}

await main()
