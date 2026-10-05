#!/usr/bin/env node
/*
 * Editor interaction measurement: the costs a page-load journey cannot see.
 *
 * `web-load-runner.mjs` measures opening a document. This measures using one:
 * typing-to-paint latency, scrolling frame health, the save round-trip and
 * whether the saved text survives a reload. It reuses that runner's target
 * lifecycle (`withTarget`) rather than starting a second harness stack, so the
 * same provenance gates apply: the API must name the expected checkout and the
 * served artifact must match the build marker on disk.
 *
 * Each sample is bounded by `--sample-timeout`, and the browser context it
 * creates is closed and awaited before the next sample starts (see
 * `probe-lifecycle.mjs`). A sample that exceeds the bound is recorded as a
 * bound, not a measurement; a sample whose resources cannot be confirmed closed
 * stops the campaign.
 *
 * Usage:
 *   Q18_PERF_EMAIL=... Q18_PERF_PASSWORD=... \
 *     node scripts/perf/editor-interaction.mjs \
 *       --serve-prod "$PWD" --expect-artifact-commit "$(git rev-parse HEAD)" \
 *       --web-url http://localhost:3003 --api-url http://localhost:8790 \
 *       --expect-checkout "$PWD" --fixtures fixtures.json \
 *       --modes typing,scroll,save --samples 5 --keys 30 \
 *       --sample-timeout 300 --out /tmp/editor-interaction.json
 *
 * `--fixtures` needs `matterId`, `documentId` and, for `--modes save`,
 * `saveDocumentId` — a separate document, so saved versions never accumulate on
 * the one whose opening time is being reported. Every id the selected modes use
 * is resolved and then confirmed against the API through the signed-in session
 * before any probe starts, so a bad target fails named instead of timing out.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { signIn } from './page-metrics.mjs'
import { makeProbes } from './editor-interaction-probes.mjs'
import { withTarget } from './web-load-runner.mjs'
import { installSignalCleanup, ownResource } from './owned-server.mjs'
import { runSamples } from './probe-lifecycle.mjs'
import {
  assertTargetsReachable,
  resolveProbeTargets,
} from './probe-preflight.mjs'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const MODES = ['typing', 'scroll', 'save']

installSignalCleanup()

const webUrl = arg('web-url', 'http://localhost:3003')
const apiUrl = arg('api-url', 'http://localhost:8790')
const outPath = arg('out')
const label = arg('label', 'run')
const samples = Number(arg('samples', '5'))
const keys = Number(arg('keys', '30'))
const ssrPort = Number(arg('ssr-port', '3102'))
const fixturesPath = arg('fixtures')
const email = process.env.Q18_PERF_EMAIL
const password = process.env.Q18_PERF_PASSWORD
const modes = (arg('modes', 'typing,scroll,save') ?? '').split(',')
const sampleTimeoutMs = Number(arg('sample-timeout', '600')) * 1000
for (const mode of modes)
  if (!MODES.includes(mode)) throw new Error(`unknown mode "${mode}"`)

const fixtures = JSON.parse(await readFile(fixturesPath, 'utf8'))
// CLI overrides win, as they always have, and are validated with the fixtures.
const documentId = arg('document-id', fixtures.documentId)
const saveDocumentId = arg('save-document-id', fixtures.saveDocumentId)
// Resolve every id the selected modes read before anything expensive starts.
const targets = resolveProbeTargets(
  { ...fixtures, documentId, saveDocumentId },
  modes,
)
const ids = Object.fromEntries(
  targets.documents.map(({ key, id }) => [key, id]),
)

const browser = await chromium.launch()
// Register the browser in the same ledger as the owned servers, so an
// interrupt closes it along with them rather than orphaning it.
const releaseBrowser = ownResource(() => browser.close())
let target
try {
  target = await withTarget({
    serveProd: arg('serve-prod'),
    webUrl,
    apiUrl,
    expectCheckout: arg('expect-checkout'),
    expectArtifactCommit: arg('expect-artifact-commit'),
    allowUnverifiedArtifact: process.argv.includes(
      '--allow-unverified-artifact',
    ),
    ssrPort,
  })
} catch (error) {
  await browser.close()
  releaseBrowser()
  throw error
}

const results = {}
let aborted = null
try {
  const authContext = await browser.newContext()
  await signIn(await authContext.newPage(), { webUrl, email, password })
  // The context's own request client carries the session cookie, so this is the
  // same boundary the editor crosses and never a wider one.
  await assertTargetsReachable({
    get: (url) => authContext.request.get(url),
    apiUrl,
    matterId: targets.matterId,
    documents: targets.documents,
  })
  const authState = await authContext.storageState()
  await authContext.close()
  const probes = makeProbes({ webUrl, fixtures, authState, browser })

  for (const mode of modes) {
    const id = mode === 'save' ? ids.saveDocumentId : ids.documentId
    const {
      rows,
      failed,
      aborted: modeAbort,
    } = await runSamples({
      mode,
      samples,
      timeoutMs: sampleTimeoutMs,
      probe: (ownership) =>
        mode === 'typing'
          ? probes.typingSample(id, keys, ownership)
          : mode === 'scroll'
            ? probes.scrollSample(id, ownership)
            : probes.saveSample(id, ownership),
      confirmIdle: () => browser.contexts().length === 0,
      onProgress: (index) =>
        console.error(`${label} ${mode} ${index + 1}/${samples} done`),
    })
    results[mode] = {
      samples: rows,
      failedSamples: failed,
      aborted: modeAbort,
      typedKeysPerSample: mode === 'typing' ? keys : undefined,
      latencyP50Ms: rows.map((r) => r.latency?.p50Ms).filter((v) => v != null),
      latencyP95Ms: rows.map((r) => r.latency?.p95Ms).filter((v) => v != null),
      paintedMs: rows.map((r) => r.paintedMs),
      acceptedKeystroke: rows.map((r) => r.acceptedKeystroke),
      editableMs: rows.map((r) => r.editableMs),
      frameP95Ms: rows.map((r) => r.frameGaps?.p95Ms).filter((v) => v != null),
      framesOver50ms: rows.map((r) => r.framesOver50ms),
      totalBlockingMs: rows.map((r) => r.totalBlockingMs),
      persisted: rows.map((r) => r.persisted).filter((v) => v != null),
      responseMs: rows.map((r) => r.responseMs).filter((v) => v != null),
    }
    if (modeAbort) {
      aborted = { mode, reason: modeAbort }
      break
    }
  }
} finally {
  try {
    await browser.close()
  } finally {
    releaseBrowser()
    await target.stop()
  }
}

const report = {
  label,
  conditions: { samples, keys, modes, sampleTimeoutMs, webUrl, apiUrl },
  target: target.identity,
  aborted,
  results,
}
const json = JSON.stringify(report, null, 2)
if (outPath) await writeFile(outPath, json)
console.log(json)
if (aborted) process.exitCode = 1
