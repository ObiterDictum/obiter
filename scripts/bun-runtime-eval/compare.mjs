#!/usr/bin/env node
/*
 * Runtime comparison: native Bun.serve against the existing @hono/node-server
 * adapter, over the identical application.
 *
 * Task-owned experiment harness. Not shipping code, not a CI gate. It reuses
 * the repository's own load tooling for the parts that already exist
 * (`fixtures.mjs`, `provision.mjs`, `psql.mjs`, `target.mjs`, and the
 * neighbour-quiet rules in `host-observation.mjs`) and adds only the journey
 * matrix, the paired-round runner and the report.
 *
 *   node scripts/bun-runtime-eval/compare.mjs --runtime node --out /tmp/n.json
 *   node scripts/bun-runtime-eval/compare.mjs --runtime bun  --out /tmp/b.json
 *   node scripts/bun-runtime-eval/compare.mjs --paired --rounds 3 --out /tmp/p.json
 *
 * The measured process is started by this harness, against this checkout's own
 * database and port. Nothing outside the checkout is read or written.
 */
import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { Agent, request as httpRequest } from 'node:http'
import { cpus, freemem, loadavg, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
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
  neighbourReport,
  neighbourUsage,
} from '../load/host-observation.mjs'
import { createQuerier } from '../load/psql.mjs'
import { fixtureIds, newRunTag, provisionFixtures } from '../load/provision.mjs'
import { databaseNameFromUrl, readEnvAssignment } from '../load/target.mjs'

const WORKTREE = resolve(import.meta.dirname, '..', '..')
const API_DIR = join(WORKTREE, 'services', 'api')
const ENV_FILE = join(WORKTREE, '.env')
const BUN_BIN =
  process.env.BUN_EVAL_BUN ?? '/tmp/obiter-bun-eval/tools/bun-linux-x64/bun'
const TSX_CLI = join(WORKTREE, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const OWNED_DATABASE = 'obiter_bun_eval'
/** A name that is never a real unit, so every running Obiter unit is a neighbour. */
const NEIGHBOUR_PROBE_UNIT = 'obiter-bun-eval-probe.service'

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const out = {
    runtime: null,
    paired: false,
    rounds: 3,
    out: null,
    port: 8811,
    journeys: null,
    settleMs: 4000,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (key === '--paired') out.paired = true
    else if (key === '--runtime') out.runtime = argv[++i]
    else if (key === '--rounds') out.rounds = Number(argv[++i])
    else if (key === '--out') out.out = argv[++i]
    else if (key === '--port') out.port = Number(argv[++i])
    else if (key === '--journeys') out.journeys = argv[++i].split(',')
    else if (key === '--settle-ms') out.settleMs = Number(argv[++i])
    else throw new Error(`unknown argument ${key}`)
  }
  if (!out.paired && !Object.keys(RUNTIMES).includes(out.runtime))
    throw new Error(
      '--runtime node|bun|node-compiled|bun-compiled, or --paired',
    )
  if (!out.out) throw new Error('--out is required')
  return out
}

// ------------------------------------------------------------- server spawn

const RUNTIMES = {
  node: () => ({
    command: process.execPath,
    args: [TSX_CLI, 'src/server.ts'],
    transform: 'tsx (on-the-fly)',
  }),
  bun: () => ({
    command: BUN_BIN,
    args: ['run', 'src/server-bun.ts'],
    transform: 'bun native TS',
  }),
  'node-compiled': () => ({
    command: process.execPath,
    args: ['dist/server.js'],
    transform: 'esbuild ahead-of-time',
  }),
  'bun-compiled': () => ({
    command: BUN_BIN,
    args: ['dist-bun/server-bun.js'],
    transform: 'esbuild ahead-of-time',
  }),
}

/**
 * Start one API process and wait until it answers /api/health for this
 * checkout. Readiness is the wall time from spawn to first 200.
 *
 * `tsx` is a wrapper: the CLI process spawns the real server as a child. The
 * measured process is therefore the whole process tree — RSS is summed and CPU
 * is summed — because attributing only the wrapper's memory to the Node
 * runtime would flatter it by roughly a third.
 */
async function startServer({ runtime, port, logPath, settleMs }) {
  const spec = RUNTIMES[runtime]()
  const child = spawn(spec.command, spec.args, {
    cwd: API_DIR,
    // PORT is the only configuration the two adapters read differently;
    // everything else is the inherited environment, so both runtimes see the
    // same values. `detached` puts each run in its own process group, which is
    // what makes tree-wide sampling and tree-wide teardown exact.
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  const log = []
  const collect = (chunk) => {
    log.push(chunk.toString())
    if (log.length > 2000) log.splice(0, log.length - 2000)
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)

  const started = performance.now()
  const origin = `http://127.0.0.1:${port}`
  let readyMs = null
  const deadline = started + 120_000
  while (performance.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(
        `${runtime} exited with ${child.exitCode} before readiness:\n${log.join('')}`,
      )
    try {
      const response = await fetch(`${origin}/api/health`, {
        signal: AbortSignal.timeout(2000),
      })
      if (response.ok) {
        readyMs = performance.now() - started
        break
      }
    } catch {
      // not listening yet
    }
    await sleep(50)
  }
  if (readyMs === null)
    throw new Error(`${runtime} never became ready:\n${log.join('')}`)

  // Idle RSS after the detection model has warmed and the heap has settled.
  await sleep(settleMs)
  const idle = await sampleTree(child.pid)
  await writeFile(logPath, log.join(''), 'utf8').catch(() => {})
  return { child, readyMs, origin, idleRssKb: idle.rssKb, spec, log }
}

async function stopServer(server) {
  if (server.child.exitCode !== null) return
  try {
    process.kill(-server.child.pid, 'SIGTERM')
  } catch {
    server.child.kill('SIGTERM')
  }
  const deadline = Date.now() + 12_000
  while (server.child.exitCode === null && Date.now() < deadline)
    await sleep(100)
  if (server.child.exitCode === null) {
    try {
      process.kill(-server.child.pid, 'SIGKILL')
    } catch {
      server.child.kill('SIGKILL')
    }
  }
}

/** Pids of a process group, via /proc (no ps dependency). */
async function groupPids(pgid) {
  const { readdir } = await import('node:fs/promises')
  const pids = []
  for (const entry of await readdir('/proc')) {
    if (!/^[0-9]+$/.test(entry)) continue
    try {
      const stat = await readFile(`/proc/${entry}/stat`, 'utf8')
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      if (Number(fields[2]) === pgid) pids.push(Number(entry))
    } catch {
      // process exited between readdir and read
    }
  }
  return pids
}

/** RSS and cumulative CPU for one pid, from /proc. */
async function sampleProcess(pid) {
  try {
    const statm = await readFile(`/proc/${pid}/statm`, 'utf8')
    const rssKb = (Number(statm.split(' ')[1]) * 4096) / 1024
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    const cpuMs = (Number(fields[11]) + Number(fields[12])) * 10
    return { rssKb, cpuMs }
  } catch {
    return { rssKb: null, cpuMs: null }
  }
}

/** RSS and cumulative CPU summed over the server's whole process group. */
async function sampleTree(pgid) {
  const pids = await groupPids(pgid)
  let rssKb = 0
  let cpuMs = 0
  for (const pid of pids) {
    const sample = await sampleProcess(pid)
    if (sample.rssKb) rssKb += sample.rssKb
    if (sample.cpuMs) cpuMs += sample.cpuMs
  }
  return { rssKb: rssKb === 0 ? null : rssKb, cpuMs, pids: pids.length }
}

// ---------------------------------------------------------------- transport

async function timedFetch(url, init) {
  const started = performance.now()
  const response = await fetch(url, init)
  const body = await response.arrayBuffer()
  return {
    ms: performance.now() - started,
    status: response.status,
    bytes: body.byteLength,
    headers: response.headers,
  }
}

/** Reuse one keep-alive connection for N requests and time each one. */
async function keepAliveSequence({ port, path, headers, count }) {
  const agent = new Agent({ keepAlive: true, maxSockets: 1 })
  const times = []
  let failures = 0
  for (let i = 0; i < count; i += 1) {
    const started = performance.now()
    const ok = await new Promise((done) => {
      const request = httpRequest(
        { host: '127.0.0.1', port, path, headers, agent },
        (response) => {
          response.resume()
          response.on('end', () => done(response.statusCode === 200))
        },
      )
      request.on('error', () => done(false))
      request.end()
    })
    times.push(performance.now() - started)
    if (!ok) failures += 1
  }
  agent.destroy()
  return { times, failures }
}

/** Download with a deliberately slow reader, to exercise backpressure. */
function slowDownload(url, { token, readDelayMs }) {
  return new Promise((done) => {
    const parsed = new URL(url)
    const started = performance.now()
    const request = httpRequest(
      {
        host: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        headers: bearer(token),
      },
      (response) => {
        let bytes = 0
        response.on('data', (chunk) => {
          bytes += chunk.length
          response.pause()
          setTimeout(() => response.resume(), readDelayMs)
        })
        response.on('end', () =>
          done({
            ms: performance.now() - started,
            status: response.statusCode,
            bytes,
          }),
        )
      },
    )
    request.on('error', (error) =>
      done({
        ms: performance.now() - started,
        status: 0,
        bytes: 0,
        note: error.message,
      }),
    )
    request.end()
  })
}

// --------------------------------------------------------------- statistics

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  )
  return sorted[index]
}

function summarise(samples) {
  const values = samples
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
  if (values.length === 0) return null
  return {
    count: values.length,
    p50: round(percentile(values, 0.5)),
    p95: round(percentile(values, 0.95)),
    min: round(values[0]),
    max: round(values[values.length - 1]),
  }
}

const round = (value) =>
  value === null || value === undefined ? null : Math.round(value * 100) / 100

// ------------------------------------------------------------------ journeys

const bearer = (token) => (token ? { Authorization: `Bearer ${token}` } : {})
const json = (body, token) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...bearer(token) },
  body: JSON.stringify(body),
})

/**
 * Text long enough to make the ONNX detector do real chunked work: the
 * configured chunk size is 400 tokens, so this is several chunks of
 * entity-dense prose. Synthetic, no client data.
 */
const INFERENCE_TEXT = Array.from(
  { length: 60 },
  (_, index) =>
    `Clause ${index + 1}. The parties acknowledge that Acme Holdings Limited, ` +
    `registered at 14 Fenchurch Street, London, and its director Ms Jane Whitfield ` +
    `(jane.whitfield@example.test, +44 7700 900123) shall keep the terms of this ` +
    `agreement confidential and shall not disclose them to any third party without ` +
    `prior written consent, save as required by law or by a competent regulatory authority.`,
).join(' ')

function buildJourneyMatrix({
  origin,
  ids,
  fixtures,
  documentId,
  versionId,
  textDocumentId,
}) {
  const medium = fixtures.find((entry) => entry.size === 'medium')
  const small = fixtures.find((entry) => entry.size === 'small')

  const upload = (entry) => async () => {
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
    return timedFetch(`${origin}/api/matters/${ids.matterId}/documents`, {
      method: 'POST',
      headers: bearer(ids.sessionToken),
      body: form,
    })
  }

  return [
    // Control only: a route that walks no data is not a product measurement.
    {
      name: 'health',
      requests: 40,
      concurrency: 4,
      run: () => timedFetch(`${origin}/api/health`),
    },
    {
      name: 'auth_me',
      requests: 40,
      concurrency: 4,
      run: () =>
        timedFetch(`${origin}/api/me`, { headers: bearer(ids.sessionToken) }),
    },
    {
      name: 'matters_list',
      requests: 40,
      concurrency: 4,
      run: () =>
        timedFetch(`${origin}/api/matters`, {
          headers: bearer(ids.sessionToken),
        }),
    },
    {
      name: 'matter_read',
      requests: 40,
      concurrency: 4,
      run: () =>
        timedFetch(`${origin}/api/matters/${ids.matterId}`, {
          headers: bearer(ids.sessionToken),
        }),
    },
    {
      name: 'matter_documents',
      requests: 40,
      concurrency: 4,
      run: () =>
        timedFetch(`${origin}/api/matters/${ids.matterId}/documents`, {
          headers: bearer(ids.sessionToken),
        }),
    },
    {
      name: 'search',
      requests: 24,
      concurrency: 2,
      run: () =>
        timedFetch(
          `${origin}/api/search/fetch`,
          json(
            {
              query: 'duty of care negligence',
              sourceType: 'judgment',
              foregroundLiveResults: false,
            },
            ids.sessionToken,
          ),
        ),
    },
    {
      name: 'search_readiness',
      requests: 20,
      concurrency: 2,
      run: () => timedFetch(`${origin}/api/search/readiness`),
    },
    {
      name: 'upload_small_extract',
      requests: 10,
      concurrency: 2,
      run: upload(small),
    },
    {
      name: 'upload_medium_extract',
      requests: 8,
      concurrency: 2,
      run: upload(medium),
    },
    {
      name: 'verification_run',
      requests: 8,
      concurrency: 1,
      run: () =>
        timedFetch(
          `${origin}/api/documents/${documentId}/verification-runs`,
          json({ versionId }, ids.sessionToken),
        ),
    },
    {
      name: 'redaction_run_inference',
      requests: 12,
      concurrency: 1,
      run: () =>
        timedFetch(
          `${origin}/api/redaction-runs`,
          json(
            {
              filename: `inference-${randomBytes(4).toString('hex')}.txt`,
              text: INFERENCE_TEXT,
              policyMode: 'internal_ai_minimisation',
            },
            ids.sessionToken,
          ),
        ),
    },
    {
      name: 'document_text_read',
      requests: 12,
      concurrency: 2,
      run: () =>
        timedFetch(`${origin}/api/documents/${textDocumentId}/text`, {
          headers: bearer(ids.sessionToken),
        }),
    },
    {
      name: 'download_stream',
      requests: 12,
      concurrency: 2,
      run: () =>
        timedFetch(`${origin}/api/documents/${documentId}/download`, {
          headers: bearer(ids.sessionToken),
        }),
    },
    {
      name: 'download_stream_slow_reader',
      requests: 6,
      concurrency: 2,
      run: () =>
        slowDownload(`${origin}/api/documents/${documentId}/download`, {
          token: ids.sessionToken,
          readDelayMs: 25,
        }),
    },
    {
      name: 'keep_alive_sequence',
      requests: 1,
      concurrency: 1,
      run: async () => {
        const result = await keepAliveSequence({
          port: Number(new URL(origin).port),
          path: '/api/matters',
          headers: bearer(ids.sessionToken),
          count: 30,
        })
        const sorted = [...result.times].sort((a, b) => a - b)
        return {
          ms: sorted[Math.floor(sorted.length / 2)],
          status: result.failures === 0 ? 200 : 0,
          bytes: 0,
          note: `${result.failures} failures over 30 requests on one reused connection`,
        }
      },
    },
  ]
}

// -------------------------------------------------------------- measurement

async function runJourney(journey) {
  const results = []
  const errors = []
  let next = 0
  const worker = async () => {
    while (next < journey.requests) {
      next += 1
      try {
        const result = await journey.run()
        results.push(result)
        if (result.status < 200 || result.status >= 400)
          errors.push(`${journey.name}: HTTP ${result.status}`)
      } catch (error) {
        errors.push(
          `${journey.name}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }
  const started = performance.now()
  await Promise.all(Array.from({ length: journey.concurrency }, worker))
  const elapsedMs = performance.now() - started
  const latencies = results.map((result) => result.ms)
  return {
    name: journey.name,
    requests: journey.requests,
    concurrency: journey.concurrency,
    samples: latencies.length,
    latency: summarise(latencies),
    throughputPerSecond: round((latencies.length / elapsedMs) * 1000),
    errors,
    bytes: results.reduce((sum, result) => sum + (result.bytes ?? 0), 0),
    note: results.find((result) => result.note)?.note ?? null,
  }
}

async function measureRuntime({
  runtime,
  port,
  outDir,
  ids,
  fixtures,
  documentId,
  versionId,
  textDocumentId,
  settleMs,
  journeyFilter,
}) {
  const server = await startServer({
    runtime,
    port,
    logPath: join(outDir, `${runtime}-${Date.now()}.log`),
    settleMs,
  })
  const neighboursBefore = await neighbourUsage(NEIGHBOUR_PROBE_UNIT)
  const cpuTicksBefore = await hostCpuTicks()
  const hostBefore = {
    freeMb: Math.round(freemem() / 1048576),
    load: loadavg().map(round),
  }
  const matrix = buildJourneyMatrix({
    origin: server.origin,
    ids,
    fixtures,
    documentId,
    versionId,
    textDocumentId,
  })
  const journeys = journeyFilter
    ? matrix.filter((journey) => journeyFilter.includes(journey.name))
    : matrix

  const cpuStart = await sampleTree(server.child.pid)
  // The load generator shares the four vCPUs with the server, so its own CPU is
  // measured too. If the driver were the bottleneck the server numbers would
  // describe the harness, not the runtime.
  const driverCpuStart = process.cpuUsage()
  let peakRssKb = server.idleRssKb
  const results = []
  for (const journey of journeys) {
    // Warm-up: the first request on a journey pays connection setup and any
    // lazily-built statement cache, which is start-up behaviour rather than
    // sustained handling.
    for (let i = 0; i < Math.min(3, journey.requests); i += 1)
      await journey.run().catch(() => {})
    results.push(await runJourney(journey))
    const sample = await sampleTree(server.child.pid)
    if (sample.rssKb && (!peakRssKb || sample.rssKb > peakRssKb))
      peakRssKb = sample.rssKb
  }
  const cpuEnd = await sampleTree(server.child.pid)
  const driverCpu = process.cpuUsage(driverCpuStart)
  const hostAfter = {
    freeMb: Math.round(freemem() / 1048576),
    load: loadavg().map(round),
  }
  const cpuTicksAfter = await hostCpuTicks()
  const neighboursAfter = await neighbourUsage(NEIGHBOUR_PROBE_UNIT)
  const hostBusy = busyFraction(cpuTicksBefore, cpuTicksAfter)
  // Four vCPUs, and this window is long: a whole-machine busy fraction below
  // this would mean the box was idle while the server supposedly worked, which
  // is evidence the load did not reach it. Above the ceiling it means something
  // else on the box was working and the window is not attributable.
  const hostBusyVerdict =
    hostBusy < 0.25
      ? 'too_quiet_to_be_this_run'
      : hostBusy > 0.95
        ? 'contended'
        : 'ok'

  await stopServer(server)
  return {
    runtime,
    transform: server.spec.transform,
    command: `${server.spec.command} ${server.spec.args.join(' ')}`,
    readyMs: round(server.readyMs),
    idleRssMb: round(server.idleRssKb / 1024),
    peakRssMb: peakRssKb ? round(peakRssKb / 1024) : null,
    cpuMs: cpuStart.cpuMs === null ? null : cpuEnd.cpuMs - cpuStart.cpuMs,
    driverCpuMs: Math.round((driverCpu.user + driverCpu.system) / 1000),
    journeys: results,
    hostBefore,
    hostAfter,
    // Whole-window evidence that no other Obiter unit was working while this
    // runtime was measured. A neighbour that did work invalidates the window,
    // which is what `neighbourContended` records.
    hostBusyFraction: round(hostBusy * 10000) / 10000,
    hostBusyVerdict,
    neighbours: {
      unitsAtStart: activeObiterUnits(),
      report: neighbourReport(neighboursBefore, neighboursAfter),
    },
    // Another Obiter unit that worked during the window, or that started in it,
    // makes the window unusable. Same rule the upload harness uses.
    neighbourContended: contendedUnits(
      neighboursBefore,
      neighboursAfter,
      1000,
    ).map((entry) => entry.name),
    log: server.log.slice(-12),
  }
}

// ---------------------------------------------------------------------- main

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
    host: {
      vcpus: cpus().length,
      node: process.version,
      bun: execFileSync(BUN_BIN, ['--version'], { encoding: 'utf8' }).trim(),
      bunRevision: execFileSync(BUN_BIN, ['--revision'], {
        encoding: 'utf8',
      }).trim(),
    },
    database: databaseName,
    mode: args.paired ? 'paired' : args.runtime,
    rounds: args.paired ? args.rounds : 1,
    driverPid: process.pid,
    measured: [],
  }

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

  const order = args.paired
    ? Array.from({ length: args.rounds }, (_, round) =>
        round % 2 === 0 ? ['node', 'bun'] : ['bun', 'node'],
      ).flat()
    : [args.runtime]

  for (const runtime of order) {
    report.measured.push(
      await measureRuntime({
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
      }),
    )
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
