#!/usr/bin/env node
/*
 * Runtime comparison runner: native Bun.serve against the @hono/node-server
 * adapter over the identical application.
 *
 * Task-owned experiment harness. Not shipping code, not a CI gate. It reuses
 * the repository's own load tooling for the parts that already exist
 * (`fixtures.mjs`, `provision.mjs`, `psql.mjs`, `target.mjs`, and the
 * neighbour-quiet rules in `host-observation.mjs`) and owns only the campaign:
 * the journey matrix (lib/journeys.mjs), the per-run measurement
 * (lib/measure.mjs), process accounting (lib/proc.mjs), the statistics
 * (lib/stats.mjs) and starting the runtime (lib/server.mjs).
 *
 *   node scripts/bun-runtime-eval/compare.mjs --runtime node-compiled --out /tmp/n.json
 *   node scripts/bun-runtime-eval/compare.mjs --pair node-compiled,bun-compiled --rounds 3 --out /tmp/p.json
 *   node scripts/bun-runtime-eval/compare.mjs --pair node-compiled,bun-compiled --rounds 3 \
 *     --journey-requests verification_run=120,redaction_run_inference=120 --out /tmp/tails.json
 *
 * `--pair A,B` runs the two rows in both orders, A/B then B/A, for the given
 * number of rounds, so start order is balanced across the campaign. The
 * measured process is started by this harness, against this checkout's own
 * database and port. Nothing outside the checkout is read or written.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  buildFixtures,
  DOCX_CONTENT_TYPE,
  fixtureFilename,
} from '../load/fixtures.mjs'
import {
  activeObiterUnits,
  busyFraction,
  contendedUnits,
  hostCpuTicks,
  neighbourUsage,
} from '../load/host-observation.mjs'
import { createQuerier } from '../load/psql.mjs'
import { fixtureIds, newRunTag, provisionFixtures } from '../load/provision.mjs'
import { databaseNameFromUrl, readEnvAssignment } from '../load/target.mjs'
import {
  hostFacts,
  measureRuntime,
  NEIGHBOUR_PROBE_UNIT,
} from './lib/measure.mjs'
import {
  ENV_FILE,
  RUNTIMES,
  startServer,
  stopServer,
  WORKTREE,
} from './lib/server.mjs'
import { bearer } from './lib/transport.mjs'

const OWNED_DATABASE = 'obiter_bun_eval'

function parseArgs(argv) {
  const out = {
    runtime: null,
    pair: null,
    rounds: 3,
    out: null,
    port: 8811,
    journeys: null,
    settleMs: 4000,
    rssIntervalMs: 250,
    quietProbeMs: 5000,
    requireQuiet: false,
    counts: {},
  }
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (key === '--runtime') out.runtime = argv[++i]
    else if (key === '--pair') out.pair = argv[++i].split(',')
    else if (key === '--paired') out.pair = ['node', 'bun']
    else if (key === '--rounds') out.rounds = Number(argv[++i])
    else if (key === '--out') out.out = argv[++i]
    else if (key === '--port') out.port = Number(argv[++i])
    else if (key === '--journeys') out.journeys = argv[++i].split(',')
    else if (key === '--journey-requests')
      out.counts = parseCounts(argv[++i], out.counts)
    else if (key === '--settle-ms') out.settleMs = Number(argv[++i])
    else if (key === '--rss-interval-ms') out.rssIntervalMs = Number(argv[++i])
    else if (key === '--quiet-probe-ms') out.quietProbeMs = Number(argv[++i])
    else if (key === '--require-quiet') out.requireQuiet = true
    else throw new Error(`unknown argument ${key}`)
  }
  const rows = out.pair ?? [out.runtime]
  for (const runtime of rows)
    if (!Object.keys(RUNTIMES).includes(runtime))
      throw new Error(
        `unknown runtime "${runtime}"; expected one of ${Object.keys(RUNTIMES).join(', ')}`,
      )
  if (out.pair && out.pair.length !== 2)
    throw new Error(
      '--pair takes exactly two runtimes, e.g. node-compiled,bun-compiled',
    )
  if (!out.out) throw new Error('--out is required')
  return out
}

function parseCounts(spec, base) {
  const counts = { ...base }
  for (const entry of spec.split(',')) {
    const [name, value] = entry.split('=')
    const count = Number(value)
    if (!name || !Number.isInteger(count) || count < 1)
      throw new Error(`bad --journey-requests entry "${entry}"`)
    counts[name] = count
  }
  return counts
}

/**
 * The quiet window before any measured process starts: how busy the host is
 * with nothing of ours running. Recorded, and optionally enforced, because a
 * campaign launched into a busy box produces numbers nobody can attribute.
 */
async function probeQuietWindow({ ms }) {
  const before = await neighbourUsage(NEIGHBOUR_PROBE_UNIT)
  const ticksBefore = await hostCpuTicks()
  await sleep(ms)
  const ticksAfter = await hostCpuTicks()
  const after = await neighbourUsage(NEIGHBOUR_PROBE_UNIT)
  const busy = busyFraction(ticksBefore, ticksAfter)
  return {
    probeMs: ms,
    hostBusyFraction: Math.round(busy * 10000) / 10000,
    neighbourContended: contendedUnits(before, after, 250).map((e) => e.name),
    activeUnits: activeObiterUnits(),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const outDir = await mkdtemp(join(tmpdir(), 'bun-eval-run-'))
  const envText = await readFile(ENV_FILE, 'utf8')
  const databaseUrl = readEnvAssignment(envText, 'DATABASE_URL', process.env)
  const databaseName = databaseNameFromUrl(databaseUrl)
  if (databaseName !== OWNED_DATABASE)
    throw new Error(
      `refusing to run: DATABASE_URL names "${databaseName}", not this experiment's ${OWNED_DATABASE}`,
    )
  const querier = createQuerier({ databaseUrl })

  const report = {
    startedAt: new Date().toISOString(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: WORKTREE,
      encoding: 'utf8',
    }).trim(),
    host: hostFacts(),
    bun: execFileSync(
      process.env.BUN_EVAL_BUN ??
        '/tmp/obiter-bun-eval/tools/bun-linux-x64/bun',
      ['--version'],
      { encoding: 'utf8' },
    ).trim(),
    bunRevision: execFileSync(
      process.env.BUN_EVAL_BUN ??
        '/tmp/obiter-bun-eval/tools/bun-linux-x64/bun',
      ['--revision'],
      { encoding: 'utf8' },
    ).trim(),
    database: databaseName,
    mode: args.pair ? 'paired' : args.runtime,
    rows: args.pair ?? [args.runtime],
    rounds: args.pair ? args.rounds : 1,
    rssIntervalMs: args.rssIntervalMs,
    journeyCounts: args.counts,
    driverPid: process.pid,
    measured: [],
  }

  report.quietWindow = await probeQuietWindow({ ms: args.quietProbeMs })
  if (args.requireQuiet && report.quietWindow.neighbourContended.length > 0)
    throw new Error(
      `refusing to start: neighbours worked during the quiet probe (${report.quietWindow.neighbourContended.join(', ')})`,
    )

  const fixtures = await buildFixtures({
    sizes: ['small', 'medium'],
    outDir: join(outDir, 'fixtures'),
  })

  // One fixture tenant for the whole campaign, created once, so every round
  // reads identical rows. A per-round tenant would make round N a different
  // database state from round 1.
  const ids = fixtureIds(newRunTag())
  const bootstrap = await startServer({
    runtime: 'node',
    port: args.port,
    logPath: join(outDir, 'bootstrap.log'),
    settleMs: 1500,
  })
  let seeded
  try {
    Object.assign(
      ids,
      await provisionFixtures({
        target: { apiOrigin: bootstrap.origin },
        querier,
        ids,
      }),
    )
    seeded = await seedDocuments({
      origin: bootstrap.origin,
      ids,
      fixtures,
      querier,
    })
    report.fixtures = {
      tag: ids.tag,
      matterId: ids.matterId,
      documentId: seeded.documentId,
      versionId: seeded.versionId,
      textDocumentId: seeded.textDocumentId,
      sizes: fixtures.map((entry) => ({
        size: entry.size,
        bytes: entry.bytes,
      })),
    }
  } finally {
    await stopServer(bootstrap)
  }

  const order = args.pair
    ? Array.from({ length: args.rounds }, (_, round) =>
        round % 2 === 0 ? args.pair : [...args.pair].reverse(),
      ).flat()
    : [args.runtime]

  for (let i = 0; i < order.length; i += 1) {
    const runtime = order[i]
    const measured = await measureRuntime({
      runtime,
      port: args.port,
      outDir,
      ids,
      fixtures,
      documentId: seeded.documentId,
      versionId: seeded.versionId,
      textDocumentId: seeded.textDocumentId,
      settleMs: args.settleMs,
      journeyFilter: args.journeys,
      journeyCounts: args.counts,
      rssIntervalMs: args.rssIntervalMs,
    })
    measured.round = args.pair ? Math.floor(i / 2) + 1 : 1
    measured.order = i % 2 === 0 ? 'first' : 'second'
    report.measured.push(measured)
    // A quiet window between processes: the previous runtime's threads and the
    // page cache both need to stop moving before the next figure means anything.
    await sleep(5000)
  }

  report.finishedAt = new Date().toISOString()
  report.driverCpuMs = Math.round(process.cpuUsage().user / 1000)
  await writeFile(args.out, JSON.stringify(report, null, 2), 'utf8')
  await rm(outDir, { recursive: true, force: true }).catch(() => {})
  console.log(`wrote ${args.out} (${report.measured.length} measured runs)`)
}

/**
 * Upload the fixtures the read, verification and download journeys need, plus a
 * plain-text document (the `/text` route only serves versions whose file type is
 * txt), then read the ids back from Postgres so the journeys do not depend on
 * the list route's JSON shape.
 */
async function seedDocuments({ origin, ids, fixtures, querier }) {
  for (const entry of fixtures) {
    for (let i = 0; i < 2; i += 1) {
      const form = new FormData()
      form.set('filename', fixtureFilename(entry))
      form.set('fileType', 'docx')
      form.set('sizeBytes', String(entry.bytes))
      form.set(
        'contentSha256',
        createHash('sha256').update(entry.content).digest('hex'),
      )
      form.set(
        'file',
        new File([entry.content], fixtureFilename(entry), {
          type: DOCX_CONTENT_TYPE,
        }),
      )
      const response = await fetch(
        `${origin}/api/matters/${ids.matterId}/documents`,
        { method: 'POST', headers: bearer(ids.sessionToken), body: form },
      )
      if (response.status !== 201)
        throw new Error(
          `seed upload answered ${response.status}: ${await response.text()}`,
        )
    }
  }

  const textContent = Buffer.from(
    Array.from(
      { length: 400 },
      (_, index) =>
        `Paragraph ${index + 1}: the parties agree that the schedule at clause 4 shall be read subject to the conditions in schedule 2.`,
    ).join('\n\n'),
    'utf8',
  )
  const textForm = new FormData()
  textForm.set('filename', 'load-fixture-text.txt')
  textForm.set('fileType', 'txt')
  textForm.set('sizeBytes', String(textContent.byteLength))
  textForm.set(
    'contentSha256',
    createHash('sha256').update(textContent).digest('hex'),
  )
  textForm.set(
    'file',
    new File([textContent], 'load-fixture-text.txt', { type: 'text/plain' }),
  )
  const textResponse = await fetch(
    `${origin}/api/matters/${ids.matterId}/documents`,
    {
      method: 'POST',
      headers: bearer(ids.sessionToken),
      body: textForm,
    },
  )
  if (textResponse.status !== 201)
    throw new Error(
      `txt seed upload answered ${textResponse.status}: ${await textResponse.text()}`,
    )

  const rows = querier.rows(`
    select coalesce(json_agg(row_to_json(r)), '[]'::json)::text
    from (
      select d.id as document_id, d.current_version_id as version_id, v.file_type, v.size_bytes
      from matter_documents d
      join document_versions v on v.id = d.current_version_id
      where d.matter_id = '${ids.matterId}' and v.document_status = 'ready'
      order by v.size_bytes desc
    ) r`)
  if (rows.length === 0)
    throw new Error('no seeded document reached a ready version')
  const text = rows.find((row) => row.file_type === 'txt')
  if (!text)
    throw new Error('the txt seed document did not reach a ready version')
  return {
    documentId: rows[0].document_id,
    versionId: rows[0].version_id,
    textDocumentId: text.document_id,
    seeded: rows.length,
  }
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
