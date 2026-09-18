#!/usr/bin/env node
/*
 * Transport timeout characterisation, with a cap long enough that neither
 * runtime's own default is truncated by the probe.
 *
 * Node's http.Server defaults (node v24) are keepAliveTimeout 5s,
 * headersTimeout 60s, requestTimeout 300s; Bun.serve has a single
 * `idleTimeout` (default 10s, set to 30s here). Those are different mechanisms,
 * so they are measured rather than asserted:
 *
 *   1. idle keep-alive  — response sent, then nothing
 *   2. half header      — request line + a partial header, never finished
 *   3. stalled body     — Content-Length announced, body never completed
 *
 *   node scripts/bun-runtime-eval/timeouts.mjs --runtime node --out /tmp/t-node.json
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as sleep } from 'node:timers/promises'
import { createQuerier } from '../load/psql.mjs'
import { fixtureIds, newRunTag, provisionFixtures } from '../load/provision.mjs'
import { databaseNameFromUrl, readEnvAssignment } from '../load/target.mjs'

const WORKTREE = resolve(import.meta.dirname, '..', '..')
const API_DIR = join(WORKTREE, 'services', 'api')
const ENV_FILE = join(WORKTREE, '.env')
const BUN_BIN =
  process.env.BUN_EVAL_BUN ?? '/tmp/obiter-bun-eval/tools/bun-linux-x64/bun'
const TSX_CLI = join(WORKTREE, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const CAP_MS = 100_000

const RUNTIMES = {
  node: () => ({ command: process.execPath, args: [TSX_CLI, 'src/server.ts'] }),
  bun: () => ({ command: BUN_BIN, args: ['run', 'src/server-bun.ts'] }),
}

function parseArgs(argv) {
  const out = { runtime: null, out: null, port: 8811 }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--runtime') out.runtime = argv[++i]
    else if (argv[i] === '--out') out.out = argv[++i]
    else if (argv[i] === '--port') out.port = Number(argv[++i])
    else throw new Error(`unknown argument ${argv[i]}`)
  }
  if (!RUNTIMES[out.runtime]) throw new Error('--runtime node|bun')
  if (!out.out) throw new Error('--out is required')
  return out
}

/** Run `onConnect` against a fresh socket; resolve with how the socket ended. */
function probe({ port, onConnect, capMs = CAP_MS, waitForClose = false }) {
  return new Promise((done) => {
    const socket = new Socket()
    const started = performance.now()
    let settled = false
    const finish = (outcome, extra = {}) => {
      if (settled) return
      settled = true
      socket.destroy()
      done({ outcome, ms: Math.round(performance.now() - started), ...extra })
    }
    socket.connect(port, '127.0.0.1', () => onConnect(socket, finish))
    let answeredAt = null
    socket.on('data', (chunk) => {
      const text = chunk.toString('latin1')
      const statuses = [...text.matchAll(/HTTP\/1\.1 (\d{3})/g)].map(
        (match) => match[1],
      )
      const last = statuses[statuses.length - 1]
      if (!last || last === '100') return
      if (!waitForClose) return finish('answered', { status: Number(last) })
      if (answeredAt === null) answeredAt = performance.now() - started
    })
    socket.on('close', () =>
      finish(
        'closed_by_peer',
        answeredAt === null ? {} : { answeredAtMs: Math.round(answeredAt) },
      ),
    )
    socket.on('error', (error) =>
      finish('socket_error', { error: error.code ?? error.message }),
    )
    setTimeout(() => finish('still_open_at_cap'), capMs)
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const outDir = await mkdtemp(join(tmpdir(), 'bun-eval-timeouts-'))
  const envText = await readFile(ENV_FILE, 'utf8')
  const databaseUrl = readEnvAssignment(envText, 'DATABASE_URL', process.env)
  if (databaseNameFromUrl(databaseUrl) !== 'obiter_bun_eval')
    throw new Error(
      'refusing to run: DATABASE_URL is not this experiment database',
    )
  const querier = createQuerier({ databaseUrl })

  const spec = RUNTIMES[args.runtime]()
  const child = spawn(spec.command, spec.args, {
    cwd: API_DIR,
    env: { ...process.env, PORT: String(args.port) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  const log = []
  child.stdout.on('data', (chunk) => log.push(chunk.toString()))
  child.stderr.on('data', (chunk) => log.push(chunk.toString()))
  const origin = `http://127.0.0.1:${args.port}`
  const started = performance.now()
  let ready = false
  while (performance.now() - started < 120_000) {
    try {
      const response = await fetch(`${origin}/api/health`, {
        signal: AbortSignal.timeout(2000),
      })
      if (response.ok) {
        ready = true
        break
      }
    } catch {
      // not up yet
    }
    await sleep(50)
  }
  if (!ready) throw new Error(`server never became ready:\n${log.join('')}`)
  await sleep(2500)

  const ids = fixtureIds(newRunTag())
  Object.assign(
    ids,
    await provisionFixtures({ target: { apiOrigin: origin }, querier, ids }),
  )

  const results = {
    runtime: args.runtime,
    node: process.version,
    bun: args.runtime === 'bun' ? '1.4.2' : null,
    capMs: CAP_MS,
    readyMs: Math.round(performance.now() - started),
  }

  // The response arrives immediately; what matters is how long the idle socket
  // then survives before the server closes it.
  results.idleKeepAlive = await probe({
    port: args.port,
    waitForClose: true,
    onConnect: (socket) =>
      socket.write(
        `GET /api/matters HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${ids.sessionToken}\r\nConnection: keep-alive\r\n\r\n`,
      ),
  })

  results.halfHeader = await probe({
    port: args.port,
    onConnect: (socket) =>
      socket.write(
        'GET /api/health HTTP/1.1\r\nHost: localhost\r\nX-Partial: ',
      ),
  })

  results.stalledBody = await probe({
    port: args.port,
    onConnect: (socket) =>
      socket.write(
        `POST /api/matters HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${ids.sessionToken}\r\n` +
          `Content-Type: application/json\r\nContent-Length: 100000\r\n\r\n{"name":"partial`,
      ),
  })

  // Bun documents `server.timeout(req, seconds)` as a per-request deadline;
  // Node has requestTimeout. Neither is used by this application, so this row
  // records what the default behaviour is, not what the app would do.
  await writeFile(args.out, JSON.stringify(results, null, 2), 'utf8')
  console.log(JSON.stringify(results, null, 2))

  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
  await sleep(1500)
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    // already gone
  }
  await rm(outDir, { recursive: true, force: true }).catch(() => {})
}

await main()
