import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { assertPortFree, waitForPort } from './page-metrics.mjs'
import { startGateway } from './gateway.mjs'

export const SSR_HOST = '127.0.0.1'
export const SHUTDOWN_GRACE_MS = 5_000

const ownedStops = new Set()
let signalCleanupInstalled = false

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

export function ownResource(stop) {
  ownedStops.add(stop)
  return () => ownedStops.delete(stop)
}

export async function startOwnedServer({ serveProd, webUrl, apiUrl, ssrPort }) {
  await assertPortFree(ssrPort)
  const ssr = spawn(process.execPath, ['serve.mjs'], {
    cwd: join(serveProd, 'apps', 'web'),
    env: {
      ...process.env,
      PORT: String(ssrPort),
      HOST: SSR_HOST,
      OBITER_WEB_ORIGIN: webUrl,
      OBITER_API_ORIGIN: apiUrl,
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
