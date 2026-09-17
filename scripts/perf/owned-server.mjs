/*
 * Ownership and teardown for the child servers the page-load runner spawns.
 *
 * The runner starts the worktree's built `serve.mjs` and a local gateway, then
 * asserts the artifact's identity against that server. An assertion that fails
 * after the spawn (wrong expected commit, stale or tampered dist, missing API)
 * must not leave the child listening: a leaked server satisfies `waitForPort`
 * on the next run and poisons it. Ownership is therefore registered before the
 * first assertion, and every exit path — success, failure, or SIGINT/SIGTERM —
 * tears down only the process this runner created. Nothing here signals a
 * listener it did not spawn.
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { assertPortFree, waitForPort } from './page-metrics.mjs'
import { startGateway } from './gateway.mjs'

export const SSR_HOST = '127.0.0.1'
// SIGTERM is enough for a Node server to close its listener; the grace period
// only bounds a server that ignores it before SIGKILL is used.
export const SHUTDOWN_GRACE_MS = 5_000

const ownedStops = new Set()
let signalCleanupInstalled = false

/** Stop every owned server, tolerating a failure so one cannot mask another. */
export async function stopOwned() {
  const stops = [...ownedStops]
  ownedStops.clear()
  await Promise.all(
    stops.map((stop) =>
      stop().catch((error) => {
        console.error(`perf runner: server cleanup failed: ${error.message}`)
      }),
    ),
  )
}

/**
 * Register SIGINT/SIGTERM cleanup once. Without this an interrupted run leaves
 * the spawned `serve.mjs` listening and poisons the next run.
 */
export function installSignalCleanup() {
  if (signalCleanupInstalled) return
  signalCleanupInstalled = true
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ]) {
    process.on(signal, () => {
      stopOwned().finally(() => process.exit(code))
    })
  }
}

/**
 * Start the worktree's built `serve.mjs` behind the local gateway and return a
 * `stop` that closes the gateway and terminates the child this run created.
 * `stop` is idempotent, waits for the child to exit, gives it a bounded SIGTERM
 * first and escalates to SIGKILL only against that child.
 */
export async function startOwnedServer({ serveProd, webUrl, apiUrl, ssrPort }) {
  // A leftover SSR server from an earlier run would satisfy waitForPort below
  // and be measured as this run's artifact; refuse it instead.
  await assertPortFree(ssrPort)
  const ssr = spawn(process.execPath, ['serve.mjs'], {
    cwd: join(serveProd, 'apps', 'web'),
    env: {
      ...process.env,
      PORT: String(ssrPort),
      HOST: SSR_HOST,
      OBITER_WEB_ORIGIN: webUrl,
      OBITER_API_ORIGIN: apiUrl,
      // Ask the server to expose the marker it loaded, so the harness can prove
      // the running process serves the artifact on disk.
      OBITER_BUILD_PROVENANCE: '1',
    },
    stdio: 'ignore',
  })
  const exited = new Promise((resolve) => ssr.once('exit', resolve))
  let gateway = null
  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    ownedStops.delete(stop)
    if (gateway) {
      // Keep-alive sockets would otherwise make close() wait for the peer.
      gateway.closeAllConnections?.()
      await new Promise((resolve) => gateway.close(resolve))
    }
    if (ssr.exitCode === null && ssr.signalCode === null) {
      ssr.kill('SIGTERM')
      const graceful = await Promise.race([
        exited.then(() => true),
        delay(SHUTDOWN_GRACE_MS).then(() => false),
      ])
      if (!graceful) ssr.kill('SIGKILL')
      await exited
    }
  }
  ownedStops.add(stop)
  try {
    await waitForPort(ssrPort)
    gateway = await startGateway({
      port: Number(new URL(webUrl).port),
      ssrOrigin: `http://${SSR_HOST}:${ssrPort}`,
      apiOrigin: apiUrl,
    })
  } catch (error) {
    await stop()
    throw error
  }
  return stop
}
