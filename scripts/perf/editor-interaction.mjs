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
 * Usage:
 *   Q18_PERF_EMAIL=... Q18_PERF_PASSWORD=... \
 *     node scripts/perf/editor-interaction.mjs \
 *       --serve-prod "$PWD" --expect-artifact-commit "$(git rev-parse HEAD)" \
 *       --web-url http://localhost:3003 --api-url http://localhost:8790 \
 *       --expect-checkout "$PWD" --fixtures fixtures.json \
 *       --modes typing,scroll,save --samples 5 --keys 30 \
 *       --out /tmp/editor-interaction.json
 *
 * `--fixtures` needs `matterId`, `documentId` and, for `--modes save`,
 * `saveDocumentId` — a separate document, so saved versions never accumulate on
 * the one whose opening time is being reported.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { signIn } from './page-metrics.mjs'
import { makeProbes } from './editor-interaction-probes.mjs'
import { withTarget } from './web-load-runner.mjs'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
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

/**
 * A sample that stops making progress must fail rather than stall the run: a
 * document that is still repaginating can leave the browser unresponsive long
 * enough that a probe never returns, and a harness that hangs silently produces
 * no evidence at all.
 */
function bounded(promise, mode, index) {
  let timer
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `${mode} sample ${index} exceeded ${sampleTimeoutMs / 1000}s`,
            ),
          ),
        sampleTimeoutMs,
      )
    }),
  ])
}

const fixtures = JSON.parse(await readFile(fixturesPath, 'utf8'))
const documentId = arg('document-id', fixtures.documentId)
const saveDocumentId = arg('save-document-id', fixtures.saveDocumentId)

const browser = await chromium.launch()
const target = await withTarget({
  serveProd: arg('serve-prod'),
  webUrl,
  apiUrl,
  expectCheckout: arg('expect-checkout'),
  expectArtifactCommit: arg('expect-artifact-commit'),
  allowUnverifiedArtifact: process.argv.includes('--allow-unverified-artifact'),
  ssrPort,
})

const results = {}
try {
  const authContext = await browser.newContext()
  await signIn(await authContext.newPage(), { webUrl, email, password })
  const authState = await authContext.storageState()
  await authContext.close()
  const probes = makeProbes({ webUrl, fixtures, authState, browser })

  for (const mode of modes) {
    if (!['typing', 'scroll', 'save'].includes(mode))
      throw new Error(`unknown mode "${mode}"`)
    const id = mode === 'save' ? saveDocumentId : documentId
    if (!id)
      throw new Error(`--fixtures needs a document id for mode "${mode}"`)
    const rows = []
    const failed = []
    for (let i = 0; i < samples; i += 1) {
      const run =
        mode === 'typing'
          ? probes.typingSample(id, keys)
          : mode === 'scroll'
            ? probes.scrollSample(id)
            : probes.saveSample(id)
      try {
        rows.push({ index: i, ...(await bounded(run, mode, i)) })
      } catch (error) {
        failed.push({ index: i, reason: error.message })
      }
      console.error(`${label} ${mode} ${i + 1}/${samples} done`)
    }
    results[mode] = {
      samples: rows,
      failedSamples: failed,
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
  }
} finally {
  await browser.close()
  await target.stop()
}

const report = {
  label,
  conditions: { samples, keys, modes, webUrl, apiUrl },
  target: target.identity,
  results,
}
const json = JSON.stringify(report, null, 2)
if (outPath) await writeFile(outPath, json)
console.log(json)
