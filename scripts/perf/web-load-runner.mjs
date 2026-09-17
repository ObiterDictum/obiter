#!/usr/bin/env node
/*
 * Production page-load measurement runner.
 *
 * Measures a running web target with a headless Chromium on fixed journeys and
 * writes one sanitised JSON report. It is explicit about the conditions it can
 * tell apart, because conflating them is how a measurement ends up proving the
 * wrong thing:
 *
 *   --cache cold|warm     a fresh browser context per sample (empty HTTP cache)
 *                         versus re-navigating inside one context
 *   --nav hard|client     page.goto versus clicking the in-app link
 *   --emulate-network     none, or a labelled CDP profile (fast3g, slow4g)
 *   --serve-prod <dir>    start apps/web/serve.mjs behind a local gateway that
 *                         mirrors production's same-origin /api split
 *
 * It refuses to measure unless it can attribute the run: the API's /api/health
 * must name the expected checkout, and the served web artifact must match the
 * build provenance written into its dist (commit, clean state, integrity).
 * Runner, artifact and API identities are recorded separately because a current
 * checkout does not prove the bytes being served were built from it.
 *
 * Every sample is gated on the journey's final path and route-ready control; a
 * redirect to sign-in, an error screen or a wrong document fails the journey and
 * is recorded rather than reported under the target's name. Public journeys need
 * no credentials; authenticated ones need Q18_PERF_EMAIL/Q18_PERF_PASSWORD and
 * their fixtures. Nothing read from the environment enters the report.
 *
 * Usage:
 *   Q18_PERF_EMAIL=... Q18_PERF_PASSWORD=... \
 *     node scripts/perf/web-load-runner.mjs \
 *       --serve-prod /path/to/worktree --expect-artifact-commit <sha> \
 *       --web-url http://localhost:3002 --api-url http://localhost:8789 \
 *       --expect-checkout /path/to/worktree \
 *       --fixtures scripts/perf/fixtures.example.json \
 *       --journeys sign-in,home,matters --samples 5 --out /tmp/perf.json
 */
import { execFileSync, spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { JOURNEYS, resolvePath } from './journeys.mjs'
import {
  COLLECT_INIT_SCRIPT,
  NETWORK_PROFILES,
  assertPortFree,
  collect,
  milestones,
  signIn,
  waitForPort,
} from './page-metrics.mjs'
import { evaluateJourney, journeyNeedsAuth } from './journey-outcome.mjs'
import { startGateway } from './gateway.mjs'
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

/** The harness's own checkout, recorded so a report names what ran the run. */
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

/** Fail loudly rather than polling an API target whose identity is unknown. */
async function assertApiIdentity() {
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

async function assertWebRenders() {
  const signInUrl = `${webUrl}/sign-in`
  const page = await fetch(signInUrl).catch((error) => {
    throw new Error(`web fetch failed for ${signInUrl}: ${error.message}`)
  })
  if (!page.ok) throw new Error(`web /sign-in returned ${page.status}`)
  const html = await page.text()
  if (!html.includes('Sign in to Obiter'))
    throw new Error('web target did not render the sign-in page')
}

/** Build provenance the running process loaded (serve.mjs holds it in memory). */
async function servedProvenance() {
  const res = await fetch(`${webUrl}/.well-known/obiter-build`).catch(
    () => null,
  )
  if (!res || !res.ok) return null
  return res.json().catch(() => null)
}

/**
 * Pin the artifact being served, not just the checkout it sits in. The marker is
 * verified against the bytes on disk and against what the running server
 * reported, so a stale Before dist under an After checkout, a dist replaced
 * after startup, or a dirty build presented as clean all refuse to measure.
 */
async function assertArtifactIdentity() {
  let disk = null
  if (serveProd) {
    disk = await verifyBuildProvenance(join(serveProd, 'apps', 'web', 'dist'), {
      expectCommit: expectArtifactCommit,
      requireClean: true,
    })
  }
  const served = await servedProvenance()
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

async function assertTargetIdentity() {
  const [api] = await Promise.all([assertApiIdentity(), assertWebRenders()])
  const artifact = await assertArtifactIdentity()
  return { runner: runnerIdentity(), api, artifact }
}

/** One sample, gated on landing on the journey that was asked for. */
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
          .getByRole('link', { name: journey.clientNavName })
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

async function withTarget(options) {
  if (!options.serveProd)
    return { identity: await assertTargetIdentity(), stop: async () => {} }
  const port = Number(new URL(options.webUrl).port)
  // A leftover SSR server from an earlier run would satisfy waitForPort below
  // and be measured as this run's artifact; refuse it instead.
  await assertPortFree(3102)
  const ssr = spawn(process.execPath, ['serve.mjs'], {
    cwd: `${options.serveProd}/apps/web`,
    env: {
      ...process.env,
      PORT: '3102',
      HOST: '127.0.0.1',
      OBITER_WEB_ORIGIN: options.webUrl,
      OBITER_API_ORIGIN: options.apiUrl,
      // Ask the server to expose the marker it loaded, so the harness can prove
      // the running process serves the artifact on disk.
      OBITER_BUILD_PROVENANCE: '1',
    },
    stdio: 'ignore',
  })
  await waitForPort(3102)
  const gateway = await startGateway({
    port,
    ssrOrigin: 'http://127.0.0.1:3102',
    apiOrigin: options.apiUrl,
  })
  const identity = await assertTargetIdentity()
  return {
    identity,
    stop: async () => {
      await new Promise((resolve) => gateway.close(resolve))
      ssr.kill('SIGTERM')
    },
  }
}

async function main() {
  const fixtures = fixturesPath
    ? JSON.parse(await readFile(fixturesPath, 'utf8'))
    : {}
  const selected = journeyIds ? journeyIds.split(',') : null
  const journeys = JOURNEYS.filter((j) => !selected || selected.includes(j.id))
  if (journeys.length === 0) throw new Error('no journeys selected')

  const target = await withTarget({ serveProd, webUrl, apiUrl })
  const browser = await chromium.launch()
  const results = []
  const failures = []
  try {
    // Credentials are only required by journeys that need them, so a public-only
    // run (sign-in, and any future public route) measures without them.
    let auth = { state: 'not-needed', storageState: null, error: null }
    if (journeys.some(journeyNeedsAuth)) {
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

    for (const journey of journeys) {
      if (journeyNeedsAuth(journey) && auth.state !== 'ok') {
        results.push({
          id: journey.id,
          status: 'failed',
          error: auth.error ?? 'no authenticated session',
        })
        failures.push(journey.id)
        continue
      }
      // Validate the fixture placeholders before measuring: a missing id would
      // otherwise measure /matters// and report it as a fast page.
      try {
        resolvePath(journey.path, fixtures)
      } catch (error) {
        results.push({ id: journey.id, status: 'failed', error: error.message })
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
      // Warm the cache with one navigation; failures here are recorded by the
      // measured samples below rather than aborting the whole run.
      if (context) {
        try {
          await sample({ context, journey, fixtures })
        } catch {
          // The measured samples report the reason.
        }
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
  } finally {
    await browser.close()
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

main().catch((error) => {
  console.error(`perf runner failed: ${error.message}`)
  process.exit(1)
})
