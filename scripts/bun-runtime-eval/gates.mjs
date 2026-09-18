#!/usr/bin/env node
/*
 * Runtime compatibility and correctness gates.
 *
 * Runs the same assertions against whichever API the harness started, so a
 * "pass" means the candidate behaved identically on that check, not that it
 * merely booted. Every check prints PASS/FAIL with the observed value; a FAIL
 * is a migration blocker, not a warning.
 *
 *   node scripts/bun-runtime-eval/gates.mjs --runtime node --out /tmp/g-node.json
 *   node scripts/bun-runtime-eval/gates.mjs --runtime bun  --out /tmp/g-bun.json
 *
 * Reuses `provision.mjs` for the authorized synthetic session (a real
 * `sessions` row validated by better-auth on every request), the repo's
 * `make-upload-fixtures.py` for a genuine DOCX, and the API's own routes to
 * create every fixture. No signup, magic-link or password-reset flow is
 * invoked and no email is sent.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildFixtures, DOCX_CONTENT_TYPE } from '../load/fixtures.mjs'
import { createQuerier } from '../load/psql.mjs'
import { fixtureIds, newRunTag, provisionFixtures } from '../load/provision.mjs'
import { databaseNameFromUrl, readEnvAssignment } from '../load/target.mjs'
import {
  BUN_BIN,
  ENV_FILE,
  OWNED_DATABASE,
  RUNTIMES,
  WORKTREE,
  bearer,
  checks,
  startServer,
  state,
  stopServer,
} from './lib/gates/harness.mjs'
import {
  checkAuthentication,
  checkAuthCookies,
  checkAuthorization,
  checkCors,
} from './lib/gates/checks-identity.mjs'
import {
  checkRequestLimits,
  checkUploadAndExtraction,
} from './lib/gates/checks-limits.mjs'
import {
  checkDatabase,
  checkNativeInference,
  checkStreaming,
  checkVerification,
} from './lib/gates/checks-content.mjs'
import {
  checkConnections,
  checkProtocol,
  checkTimeouts,
  runShutdownGate,
} from './lib/gates/checks-transport.mjs'

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

// ---------------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const outDir = await mkdtemp(join(tmpdir(), 'bun-eval-gates-'))
  const envText = await readFile(ENV_FILE, 'utf8')
  const databaseUrl = readEnvAssignment(envText, 'DATABASE_URL', process.env)
  const databaseName = databaseNameFromUrl(databaseUrl)
  if (databaseName !== OWNED_DATABASE)
    throw new Error(`refusing to run: DATABASE_URL names "${databaseName}"`)
  const querier = createQuerier({ databaseUrl })
  const fixtures = await buildFixtures({
    sizes: ['small', 'medium'],
    outDir: join(outDir, 'fixtures'),
  })

  const runTag = newRunTag()
  const ids = fixtureIds(runTag)

  const server = await startServer({
    runtime: args.runtime,
    port: args.port,
    logPath: join(outDir, `${args.runtime}.log`),
    settleMs: 3000,
  })
  const report = {
    runtime: args.runtime,
    startedAt: new Date().toISOString(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: WORKTREE,
      encoding: 'utf8',
    }).trim(),
    node: process.version,
    bun: execFileSync(BUN_BIN, ['--version'], { encoding: 'utf8' }).trim(),
    readyMs: Math.round(server.readyMs),
    checks: [],
  }
  try {
    Object.assign(
      ids,
      await provisionFixtures({
        target: { apiOrigin: server.origin },
        querier,
        ids,
      }),
    )

    // The other tenant needs one ready document of its own, so the
    // cross-tenant document refusal is proved against a row that exists.
    const otherUpload = new FormData()
    otherUpload.set('filename', 'other-tenant.docx')
    otherUpload.set('fileType', 'docx')
    otherUpload.set('sizeBytes', String(fixtures[0].bytes))
    otherUpload.set(
      'contentSha256',
      createHash('sha256').update(fixtures[0].content).digest('hex'),
    )
    otherUpload.set(
      'file',
      new File([fixtures[0].content], 'other-tenant.docx', {
        type: DOCX_CONTENT_TYPE,
      }),
    )
    const otherUploadResponse = await fetch(
      `${server.origin}/api/matters/${ids.otherMatterId}/documents`,
      {
        method: 'POST',
        headers: bearer(ids.otherSessionToken),
        body: otherUpload,
      },
    )
    if (otherUploadResponse.status !== 201)
      throw new Error(
        `seeding the other tenant failed: ${otherUploadResponse.status} ${await otherUploadResponse.text()}`,
      )

    // One shared context, threaded through every gate in the same order
    // the monolithic runGates() executed them.
    const ctx = {
      origin: server.origin,
      port: args.port,
      ids,
      fixtures,
      querier,
      runTag,
      state,
    }
    await checkAuthentication(ctx)
    await checkAuthorization(ctx)
    await checkCors(ctx)
    await checkRequestLimits(ctx)
    await checkUploadAndExtraction(ctx)
    await checkVerification(ctx)
    await checkNativeInference(ctx)
    await checkStreaming(ctx)
    await checkConnections(ctx)
    await checkDatabase(ctx)
    await checkAuthCookies(ctx)
    await checkProtocol(ctx)
    await checkTimeouts(ctx)
    await runShutdownGate({ ...ctx, server, log: server.log })
  } finally {
    report.checks = checks
    report.passed = checks.filter((check) => check.ok).length
    report.failed = checks.filter((check) => !check.ok).length
    report.serverLog = server.log.slice(-30)
    report.finishedAt = new Date().toISOString()
    await writeFile(args.out, JSON.stringify(report, null, 2), 'utf8')
    if (!server.stopped) await stopServer(server)
    await rm(outDir, { recursive: true, force: true }).catch(() => {})
  }
  console.log(
    `\n${args.runtime}: ${report.passed} passed, ${report.failed} failed -> ${args.out}`,
  )
  if (report.failed > 0) process.exitCode = 1
}

await main()
