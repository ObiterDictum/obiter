/*
 * Server lifecycle for the API runtime integration harness.
 *
 * The harness starts the *real* entry point — `services/api/src/server-bun.ts`
 * under Bun, or `services/api/src/server.ts` under Node — on its own port,
 * against the task's database, and drives it over HTTP. Nothing here mocks the
 * server, because the point is to observe the shipped adapters.
 *
 * Bounded throughout: every wait has a deadline, every child is signalled then
 * killed, and a check that hangs fails the run rather than blocking it.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { performance } from 'node:perf_hooks'
import { setTimeout as sleep } from 'node:timers/promises'

export const SERVER_ENTRY_POINTS = {
  node: 'services/api/src/server.ts',
  bun: 'services/api/src/server-bun.ts',
}

/** Ports the shared stack and the lanes own; never allocate or accept these. */
export const RESERVED_PORTS = new Set([3000, 3001, 3002, 3003, 3004, 8787])

export class LifecycleError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'LifecycleError'
    this.code = code
  }
}

/** An ephemeral loopback port: ask the OS, then release it for the child. */
export function allocatePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

export function assertUsablePort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new LifecycleError(
      'port_invalid',
      `Port ${port} is not a usable TCP port.`,
    )
  }
  if (RESERVED_PORTS.has(port)) {
    throw new LifecycleError(
      'port_reserved',
      `Refusing port ${port}: it belongs to the shared stack or a lane.`,
    )
  }
}

export function startServer({
  runtime,
  worktreeRoot,
  port,
  environment,
  bunBin,
  // Real `node`, not process.execPath: the harness runs under bun after the
  // toolchain migration, and the rollback adapter must still be exercised on
  // an actual Node runtime.
  nodeBin = 'node',
  onOutput = () => {},
}) {
  const entry = SERVER_ENTRY_POINTS[runtime]
  if (!entry) {
    throw new LifecycleError(
      'runtime_unknown',
      `Unknown runtime "${runtime}"; expected "node" or "bun".`,
    )
  }
  assertUsablePort(port)

  const command = runtime === 'bun' ? bunBin : nodeBin
  const args =
    runtime === 'bun'
      ? [`${worktreeRoot}/${entry}`]
      : ['--import', 'tsx', `${worktreeRoot}/${entry}`]

  const child = spawn(command, args, {
    cwd: worktreeRoot,
    env: { ...process.env, ...environment },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const lines = []
  const record = (stream, chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line === '') continue
      lines.push({ stream, line })
      onOutput(stream, line)
    }
  }
  child.stdout.on('data', (chunk) => record('stdout', chunk))
  child.stderr.on('data', (chunk) => record('stderr', chunk))

  return { runtime, port, child, lines, origin: `http://127.0.0.1:${port}` }
}

export function logText(server) {
  return server.lines.map((entry) => entry.line).join('\n')
}

function exitState(server) {
  return server.child.exitCode !== null || server.child.signalCode !== null
}

/**
 * Wait until `/api/health` answers 200 and names the expected runtime. A child
 * that exits first fails immediately and carries its own output back, because
 * "connection refused for 60 s" is not a diagnosis.
 */
export async function waitForHealth(
  server,
  { expectedRuntime, timeoutMs = 60_000, fetchImpl = fetch } = {},
) {
  const deadline = Date.now() + timeoutMs
  let lastError = 'no attempt made'
  while (Date.now() < deadline) {
    if (exitState(server)) {
      throw new LifecycleError(
        'server_exited',
        `${server.runtime} exited before answering /api/health.\n${logText(server)}`,
      )
    }
    try {
      const response = await fetchImpl(`${server.origin}/api/health`, {
        signal: AbortSignal.timeout(3000),
      })
      if (response.ok) {
        const body = await response.json()
        if (body?.status === 'ok' && body?.runtime === expectedRuntime) {
          return body
        }
        lastError = `health answered ${JSON.stringify(body)}`
      } else {
        lastError = `health answered ${response.status}`
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await sleep(150)
  }
  throw new LifecycleError(
    'health_timeout',
    `${server.runtime} did not report runtime="${expectedRuntime}" within ${timeoutMs} ms (${lastError}).\n${logText(server)}`,
  )
}

/**
 * Wait for a boot log line. Returns whether it appeared, so the inference check
 * can report a model that never loaded instead of hanging on it.
 */
export async function waitForLog(
  server,
  pattern,
  { timeoutMs = 120_000 } = {},
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = server.lines.find((entry) => pattern.test(entry.line))
    if (found) return found.line
    if (exitState(server)) return null
    await sleep(150)
  }
  return null
}

/** Signal the child and wait for it to exit; null when the deadline passed. */
export async function signalAndWait(server, signal, timeoutMs) {
  if (exitState(server)) {
    return { code: server.child.exitCode, signal: server.child.signalCode }
  }
  server.child.kill(signal)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (exitState(server)) {
      return { code: server.child.exitCode, signal: server.child.signalCode }
    }
    await sleep(50)
  }
  return null
}

/** Ordinary teardown: attempt a clean stop, then make sure nothing survives. */
export async function stopServer(server, { timeoutMs = 15_000 } = {}) {
  const clean = await signalAndWait(server, 'SIGTERM', timeoutMs)
  if (clean) return clean
  server.child.kill('SIGKILL')
  await signalAndWait(server, 'SIGKILL', 5000)
  return { code: server.child.exitCode, signal: server.child.signalCode }
}

/**
 * Is anything still listening on the port? Used after shutdown to prove the
 * socket was released, not merely that the process went away.
 */
export async function portIsReleased(port, { attempts = 20 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const refused = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1000),
    })
      .then(() => false)
      .catch(() => true)
    if (refused) return true
    await sleep(100)
  }
  return false
}

export function elapsedSince(startedAt) {
  return Math.round(performance.now() - startedAt)
}
