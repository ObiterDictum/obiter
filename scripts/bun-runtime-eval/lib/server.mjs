/*
 * Starting and stopping one measured API process.
 *
 * Four runtimes are supported and registered in one place so the measurement
 * driver and the gate suite cannot disagree about what a row means:
 *
 *   node           the shipping path: tsx on-the-fly, @hono/node-server
 *   bun            native Bun.serve, Bun-native TypeScript transform
 *   node-compiled  esbuild ahead-of-time, @hono/node-server
 *   bun-compiled   esbuild ahead-of-time, Bun.serve
 *
 * The compiled rows come from one esbuild pass (see build-compiled.sh), so
 * they execute identical first-party JavaScript and differ only in the socket
 * layer and the runtime.
 *
 * Every process is started detached, in its own process group, against this
 * checkout's own database and port. `detached` is what makes tree-wide
 * sampling and tree-wide teardown exact.
 */
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as sleep } from 'node:timers/promises'
import { sampleTree } from './proc.mjs'

export const WORKTREE = resolve(import.meta.dirname, '..', '..', '..')
export const API_DIR = join(WORKTREE, 'services', 'api')
export const ENV_FILE = join(WORKTREE, '.env')
export const BUN_BIN =
  process.env.BUN_EVAL_BUN ?? '/tmp/obiter-bun-eval/tools/bun-linux-x64/bun'
export const TSX_CLI = join(WORKTREE, 'node_modules', 'tsx', 'dist', 'cli.mjs')

export const RUNTIMES = {
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

export function runtimeSpec(runtime) {
  const factory = RUNTIMES[runtime]
  if (!factory) throw new Error(`unknown runtime ${runtime}`)
  return factory()
}

/**
 * Start one API process and wait until it answers /api/health for this
 * checkout. Readiness is the wall time from spawn to first 200.
 *
 * `settleMs` is the quiet period after readiness before idle memory is read:
 * the detection model warms asynchronously at boot, so reading RSS the instant
 * health answers would measure a server that has not finished loading.
 */
export async function startServer({ runtime, port, logPath, settleMs = 0 }) {
  const spec = runtimeSpec(runtime)
  const child = spawn(spec.command, spec.args, {
    cwd: API_DIR,
    // PORT is the only configuration the adapters read differently;
    // everything else is the inherited environment, so both runtimes see the
    // same values.
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
      // Not listening yet.
    }
    await sleep(50)
  }
  if (readyMs === null)
    throw new Error(`${runtime} never became ready:\n${log.join('')}`)

  let idleRssKb = null
  if (settleMs > 0) {
    await sleep(settleMs)
    idleRssKb = (await sampleTree(child.pid)).rssKb
  }
  await writeFile(logPath, log.join(''), 'utf8').catch(() => {})
  return { child, readyMs, origin, idleRssKb, spec, log, runtime }
}

export async function stopServer(server) {
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
