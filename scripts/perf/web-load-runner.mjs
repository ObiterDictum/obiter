#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { JOURNEYS, resolvePath } from './journeys.mjs'
import {
  COLLECT_INIT_SCRIPT,
  NETWORK_PROFILES,
  collect,
  milestones,
  signIn,
} from './page-metrics.mjs'
import {
  evaluateJourney,
  journeyNeedsAuth,
  clientNavProblem,
} from './journey-outcome.mjs'
import { installSignalCleanup, startOwnedServer } from './owned-server.mjs'
import { verifyBuildProvenance } from '../../apps/web/build-provenance.mjs'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const webUrl = arg('web-url', 'http://localhost:3002')
const apiUrl = arg('api-url', 'http://localhost:8789')
const expectCheckout = arg('expect-checkout')
const serveProd = arg('serve-prod')
const expectArtifactCommit = arg('expect-artifact-commit')
const allowUnverifiedArtifact = process.argv.includes(
  '--allow-unverified-artifact',
)
const outPath = arg('out')
const label = arg('label', 'run')
const samples = Number(arg('samples', '5'))
const cacheMode = arg('cache', 'cold')
const navMode = arg('nav', 'hard')
const network = arg('emulate-network', 'none')
const journeyIds = arg('journeys')
const fixturesPath = arg('fixtures')
const ssrPort = Number(arg('ssr-port', '3102'))
const email = process.env.Q18_PERF_EMAIL
const password = process.env.Q18_PERF_PASSWORD

if (cacheMode !== 'cold' && cacheMode !== 'warm')
  throw new Error('--cache cold|warm')
if (navMode !== 'hard' && navMode !== 'client')
  throw new Error('--nav hard|client')
if (network !== 'none' && !NETWORK_PROFILES[network])
  throw new Error(`unknown --emulate-network "${network}"`)
if (serveProd && !expectArtifactCommit && !allowUnverifiedArtifact)
  throw new Error(
    '--serve-prod needs --expect-artifact-commit <sha> so a stale dist cannot measure as current',
  )
if (!Number.isInteger(ssrPort) || ssrPort <= 0 || ssrPort > 65535)
  throw new Error('--ssr-port must be an integer in 1-65535')

function runnerIdentity() {
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
  const git = (args) => {
    try {
      return execFileSync('git', ['-C', repoRoot, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    } catch {
      return null
    }
  }
  const status = git(['status', '--porcelain'])
  return {
    checkoutRoot: repoRoot,
    commitSha: git(['rev-parse', 'HEAD']),
    dirty: status === null ? null : status.length > 0,
  }
}

async function assertApiIdentity({ apiUrl, expectCheckout }) {
  const healthUrl = `${apiUrl}/api/health`
  const res = await fetch(healthUrl).catch((error) => {
    throw new Error(
      `API health fetch failed for ${healthUrl}: ${error.message}`,
    )
  })
  if (!res.ok) throw new Error(`API health returned ${res.status} at ${apiUrl}`)
  const body = await res.json()
  const provenance = body?.provenance
  if (!provenance?.checkoutRoot || !provenance?.commitSha)
    throw new Error('API health carries no provenance; refusing to measure it')
  if (expectCheckout && provenance.checkoutRoot !== expectCheckout)
    throw new Error(
      `API checkout root is ${provenance.checkoutRoot}, expected ${expectCheckout}`,
    )
  return {
    checkoutRoot: provenance.checkoutRoot,
    commitSha: provenance.commitSha,
  }
}

async function assertWebRenders({ webUrl }) {
  const signInUrl = `${webUrl}/sign-in`
  const page = await fetch(signInUrl).catch((error) => {
    throw new Error(`web fetch failed for ${signInUrl}: ${error.message}`)
  })
  if (!page.ok) throw new Error(`web /sign-in returned ${page.status}`)
  const html = await page.text()
  if (!html.includes('Sign in to Obiter'))
    throw new Error('web target did not render the sign-in page')
}

async function servedProvenance(webUrl) {
  const res = await fetch(`${webUrl}/.well-known/obiter-build`).catch(
    () => null,
  )
  if (!res || !res.ok) return null
  return res.json().catch(() => null)
}

async function assertArtifactIdentity({
  serveProd,
  webUrl,
  expectArtifactCommit,
  allowUnverifiedArtifact,
}) {
  let disk = null
  if (serveProd) {
    disk = await verifyBuildProvenance(join(serveProd, 'apps', 'web', 'dist'), {
      expectCommit: expectArtifactCommit,
      requireClean: true,
    })
  }
  const served = await servedProvenance(webUrl)
  if (serveProd && !served && !allowUnverifiedArtifact)
    throw new Error(
      'the running server reported no build provenance; only an artifact built by this worktree can be measured',
    )
  if (disk && served && disk.integrity !== served.integrity)
    throw new Error(
      'the running server loaded a different artifact than dist on disk (replaced after startup)',
    )
  const marker = disk ?? served
  if (!marker) {
    if (allowUnverifiedArtifact) return { verified: false }
    throw new Error(
      'no build provenance for the served artifact; pass --allow-unverified-artifact to measure an unverifiable target',
    )
  }
  return {
    verified: true,
    source: disk && served ? 'disk+process' : disk ? 'disk' : 'process',
    commit: marker.commit,
    commitSource: marker.commitSource,
    dirty: marker.dirty,
    reactProduction: marker.reactProduction,
    integrity: marker.integrity,
    assetCount: marker.assetCount,
  }
}

async function assertTargetIdentity(config) {
  const [api] = await Promise.all([
    assertApiIdentity(config),
    assertWebRenders(config),
  ])
  const artifact = await assertArtifactIdentity(config)
  return { runner: runnerIdentity(), api, artifact }
}

async function sample({ context, journey, fixtures }) {
  const page = await context.newPage()
  const targetPath = resolvePath(journey.path, fixtures)
  try {
    if (network !== 'none') {
      const client = await context.newCDPSession(page)
      await client.send('Network.enable')
      await client.send(
        'Network.emulateNetworkConditions',
        NETWORK_PROFILES[network],
      )
    }
    let contentMs
    let readyMs
    let sinceMs = 0
    let error = null
    try {
      if (navMode === 'client' && journey.clientNavFrom) {
        const from = resolvePath(journey.clientNavFrom, fixtures)
        await page.goto(`${webUrl}${from}`, { waitUntil: 'domcontentloaded' })
        await milestones(page, 'main')
        const link = page
          .getByRole('link', {
            name: resolvePath(journey.clientNavName, fixtures),
          })
          .first()
        sinceMs = await page.evaluate(() => performance.now())
        await link.click()
        const mark = await milestones(page, journey.ready)
        contentMs = mark.contentMs - sinceMs
        readyMs = mark.readyMs - sinceMs
      } else {
        await page.goto(`${webUrl}${targetPath}`, {
          waitUntil: 'domcontentloaded',
        })
        const mark = await milestones(page, journey.ready)
        contentMs = mark.contentMs
        readyMs = mark.readyMs
      }
    } catch (caught) {
      error = caught.message.split('\n')[0]
    }
    const finalPath = await page
      .evaluate(() => location.pathname)
      .catch(() => null)
    const outcome = evaluateJourney({
      journey,
      targetPath,
      finalPath,
      ready: error === null,
      error,
    })
    if (!outcome.ok) throw new Error(outcome.reason)
    return await collect(page, contentMs, readyMs, sinceMs)
  } finally {
    await page.close()
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function summarise(rows) {
  const out = { samples: rows }
  for (const key of Object.keys(rows[0] ?? {})) {
    if (typeof rows[0][key] !== 'number') continue
    const values = rows.map((row) => row[key])
    out[`${key}Median`] = Math.round(median(values))
    out[`${key}Min`] = Math.min(...values)
    out[`${key}Max`] = Math.max(...values)
  }
  return out
}

async function withTarget(config) {
  if (!config.serveProd)
    return {
      identity: await assertTargetIdentity(config),
      stop: async () => {},
    }
  const stop = await startOwnedServer(config)
  try {
    return { identity: await assertTargetIdentity(config), stop }
  } catch (error) {
    await stop()
    throw error
  }
}

async function main() {
  installSignalCleanup()
  const fixtures = fixturesPath
    ? JSON.parse(await readFile(fixturesPath, 'utf8'))
    : {}
  const selected = journeyIds ? journeyIds.split(',') : null
  const journeys = JOURNEYS.filter((j) => !selected || selected.includes(j.id))
  if (journeys.length === 0) throw new Error('no journeys selected')

  const target = await withTarget({
    serveProd,
    webUrl,
    apiUrl,
    expectCheckout,
    expectArtifactCommit,
    allowUnverifiedArtifact,
    ssrPort,
  })
  const results = []
  const failures = []
  let browser = null
  try {
    const measurable = []
    for (const journey of journeys) {
      try {
        resolvePath(journey.path, fixtures)
        const problem = clientNavProblem(journey, navMode)
        if (problem) throw new Error(problem)
        measurable.push(journey)
      } catch (error) {
        results.push({ id: journey.id, status: 'failed', error: error.message })
        failures.push(journey.id)
      }
    }

    if (measurable.length > 0) {
      browser = await chromium.launch()
      let auth = { state: 'not-needed', storageState: null, error: null }
      if (measurable.some(journeyNeedsAuth)) {
        try {
          const authContext = await browser.newContext()
          await authContext.addInitScript(COLLECT_INIT_SCRIPT)
          await signIn(await authContext.newPage(), {
            webUrl,
            email,
            password,
          })
          auth = {
            state: 'ok',
            storageState: await authContext.storageState(),
            error: null,
          }
          await authContext.close()
        } catch (error) {
          auth = { state: 'failed', storageState: null, error: error.message }
        }
      }
      if (auth.state === 'failed')
        console.error(`perf runner: no authenticated session: ${auth.error}`)

      for (const journey of measurable) {
        if (journeyNeedsAuth(journey) && auth.state !== 'ok') {
          results.push({
            id: journey.id,
            status: 'failed',
            error: auth.error ?? 'no authenticated session',
          })
          failures.push(journey.id)
          continue
        }

        const contextOptions = {
          storageState: journey.public ? undefined : auth.storageState,
          viewport: { width: 1440, height: 900 },
        }
        const context =
          cacheMode === 'warm' ? await browser.newContext(contextOptions) : null
        if (context) await context.addInitScript(COLLECT_INIT_SCRIPT)
        if (context) {
          try {
            await sample({ context, journey, fixtures })
          } catch {}
        }
        const rows = []
        const failedSamples = []
        for (let i = 0; i < samples; i++) {
          const scoped = context ?? (await browser.newContext(contextOptions))
          if (!context) await scoped.addInitScript(COLLECT_INIT_SCRIPT)
          try {
            rows.push(await sample({ context: scoped, journey, fixtures }))
          } catch (error) {
            failedSamples.push({ index: i, reason: error.message })
          } finally {
            if (!context) await scoped.close()
          }
        }
        if (context) await context.close()
        if (rows.length === 0) {
          results.push({
            id: journey.id,
            status: 'failed',
            error: failedSamples[0]?.reason ?? 'no usable samples',
            failedSamples,
          })
          failures.push(journey.id)
        } else {
          results.push({
            id: journey.id,
            status: failedSamples.length > 0 ? 'partial' : 'ok',
            ...summarise(rows),
            failedSamples,
          })
          if (failedSamples.length > 0) failures.push(journey.id)
        }
      }
    }
  } finally {
    if (browser) await browser.close()
    await target.stop()
  }

  const report = {
    label,
    conditions: {
      cache: cacheMode,
      nav: navMode,
      network,
      samples,
      webUrl,
      apiUrl,
    },
    target: target.identity,
    failures,
    results,
  }
  const json = JSON.stringify(report, null, 2)
  if (outPath) await writeFile(outPath, json)
  console.log(json)
  if (failures.length > 0) process.exitCode = 1
}

const invokedScript = process.argv[1]
const isMain =
  invokedScript && pathToFileURL(invokedScript).href === import.meta.url
if (isMain) {
  main().catch((error) => {
    console.error(`perf runner failed: ${error.message}`)
    process.exit(1)
  })
}

export { withTarget }
