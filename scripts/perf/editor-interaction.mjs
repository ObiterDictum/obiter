#!/usr/bin/env node
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
const documentId = arg('document-id', fixtures.documentId)
const saveDocumentId = arg('save-document-id', fixtures.saveDocumentId)
const targets = resolveProbeTargets(
  { ...fixtures, documentId, saveDocumentId },
  modes,
)
const ids = Object.fromEntries(
  targets.documents.map(({ key, id }) => [key, id]),
)

const browser = await chromium.launch()
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
