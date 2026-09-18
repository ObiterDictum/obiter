#!/usr/bin/env node
/*
 * API runtime integration harness.
 *
 * Boots the real API entry points — native `Bun.serve` and the Node
 * `@hono/node-server` rollback path — against one task-owned database and
 * drives the production behaviour checks over HTTP. This is the evidence that
 * the shipped Bun server works, not that a Node test suite does.
 *
 *   node scripts/api-runtime/runtime-integration.mjs \
 *     --runtime both \
 *     --database-url postgres://obiter:obiter@localhost:5432/obiter_api_runtime
 *
 * Exits 0 only when every check passes on every requested runtime and the two
 * runtimes agree where they are expected to. Fixtures are scoped to a per-run
 * tag; the storage root is a task-owned temporary directory that is removed at
 * the end. Audit rows and database fixtures are left in place by design — the
 * target database must be this task's, and deleting audit history is not a
 * cleanup this harness is allowed to perform.
 *
 * See README.md for the check list, the safety guards and what it does not
 * cover.
 */
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { buildFixtures } from '../load/fixtures.mjs'
import { createQuerier, ProvisionError } from '../load/psql.mjs'
import { runBehaviourChecks } from './checks-behaviour.mjs'
import { runIdentityChecks } from './checks-identity.mjs'
import {
  API_DIRECTORY,
  BETTER_AUTH_SECRET,
  WORKTREE_ROOT,
  childEnvironment,
  parseArgs,
  prefetchDetectionModel,
  resolveRuntimes,
} from './config.mjs'
import {
  assertOwnedDatabase,
  fixtureIds,
  newRunTag,
  proveSession,
  provisionSql,
} from './fixtures.mjs'
import {
  LifecycleError,
  allocatePort,
  elapsedSince,
  startServer,
  stopServer,
  waitForHealth,
  waitForLog,
} from './lifecycle.mjs'
import { createRecorder, printReport } from './report.mjs'
import { runShutdownCheck } from './shutdown-check.mjs'

const MODEL_READY = /Rampart detection model ready/

async function runRuntime({
  runtime,
  args,
  fixtures,
  databaseUrl,
  rampartCacheDir,
  scratchRoot,
}) {
  const recorder = createRecorder()
  const runTag = newRunTag()
  const ids = fixtureIds(runTag)
  const port = await allocatePort()
  const storageRoot = join(scratchRoot, `storage-${runtime}`)
  await mkdir(storageRoot, { recursive: true })

  const server = startServer({
    runtime,
    worktreeRoot: WORKTREE_ROOT,
    port,
    bunBin: args.bunBin,
    environment: childEnvironment({
      port,
      databaseUrl,
      storageRoot,
      rampartCacheDir,
    }),
    onOutput: args.verbose
      ? (stream, line) => console.log(`  [${runtime}:${stream}] ${line}`)
      : undefined,
  })

  const querier = createQuerier({ databaseUrl })
  const ctx = {
    server,
    runtime,
    origin: server.origin,
    port,
    ids,
    querier,
    fixtures,
    recorder,
    apiDirectory: API_DIRECTORY,
    secret: BETTER_AUTH_SECRET,
    runTag,
    uploadedDocumentId: null,
  }
  let bootError = null
  try {
    await waitForHealth(server, { expectedRuntime: runtime })
    querier.exec(provisionSql(ids))
    await proveSession({ origin: server.origin, ids })
    // The inference check needs the model, which loads asynchronously at boot.
    // Waiting here keeps that check about inference rather than about timing.
    await waitForLog(server, MODEL_READY, { timeoutMs: 120_000 })

    await runIdentityChecks(ctx)
    await runBehaviourChecks(ctx)

    const fixture =
      fixtures.find((entry) => entry.size === 'medium') ?? fixtures[0]
    await runShutdownCheck({
      server,
      ids,
      uploadedDocumentId: ctx.uploadedDocumentId,
      recorder,
      expectedBytes: fixture.bytes,
    })
  } catch (error) {
    bootError = error
  }

  // The shutdown check normally ends the process; anything still running here
  // is a failed drain or a boot failure, and must not outlive the run.
  if (server.child.exitCode === null) await stopServer(server)

  if (bootError) {
    recorder.record(
      'the runtime completed the harness',
      false,
      bootError instanceof Error ? bootError.message : String(bootError),
    )
  }

  const checks = recorder.results
  const passed = checks.filter((check) => check.ok).length
  recorder.record(
    `${runtime} entry point completed every check`,
    checks.every((check) => check.ok),
    `${passed}/${checks.length} checks passed`,
  )

  return { runtime, checks, ids, bootError }
}

/**
 * Where the two runtimes must agree. The malformed-multipart status is a
 * pre-existing defect (board P1.41) that this migration must not change, so
 * agreement is the assertion rather than a specific status code.
 */
function parityFailures(results) {
  if (results.length < 2) return []
  const observed = (checks) =>
    checks.find((check) =>
      check.name.startsWith('malformed and truncated multipart'),
    )?.observed
  const malformed = results.map((result) => ({
    runtime: result.runtime,
    value: observed(result.checks),
  }))
  const [first, second] = malformed
  if (
    first?.value &&
    second?.value &&
    (first.value.malformedBoundaryStatus !==
      second.value.malformedBoundaryStatus ||
      first.value.truncatedMultipartStatus !==
        second.value.truncatedMultipartStatus)
  ) {
    return [
      `malformed multipart differs: ${JSON.stringify(first)} vs ${JSON.stringify(second)}`,
    ]
  }
  return []
}

function assertBunRunnable(bunBin) {
  try {
    execFileSync(bunBin, ['--version'], { encoding: 'utf8' })
  } catch {
    throw new LifecycleError(
      'bun_missing',
      `Bun is not runnable as "${bunBin}". Install the pinned version ` +
        '(.bun-version) or pass --bun-bin <path>.',
    )
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(
      'Usage: node scripts/api-runtime/runtime-integration.mjs --database-url <url> ' +
        '[--runtime node|bun|both] [--allow-database <name>] [--bun-bin <path>] [--keep] [--verbose]',
    )
    return
  }

  const databaseName = assertOwnedDatabase({
    databaseUrl: args.databaseUrl,
    allowDatabase: args.allowDatabase,
  })
  const runtimes = resolveRuntimes(args.runtime)
  if (runtimes.includes('bun')) assertBunRunnable(args.bunBin)

  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: WORKTREE_ROOT,
    encoding: 'utf8',
  }).trim()
  const scratchRoot = await mkdtemp(join(tmpdir(), 'obiter-api-runtime-'))
  const rampartCacheDir =
    args.rampartCacheDir ?? join(scratchRoot, 'rampart-models')
  await prefetchDetectionModel({
    cacheDir: rampartCacheDir,
    worktreeRoot: WORKTREE_ROOT,
  })

  console.log(
    `API runtime integration: database=${databaseName} runtimes=${runtimes.join(',')} head=${head}`,
  )

  const fixtures = await buildFixtures({
    sizes: ['small', 'medium'],
    outDir: join(scratchRoot, 'fixtures'),
  })

  const results = []
  for (const runtime of runtimes) {
    const startedAt = performance.now()
    const result = await runRuntime({
      runtime,
      args,
      fixtures,
      databaseUrl: args.databaseUrl,
      rampartCacheDir,
      scratchRoot,
    })
    console.log(
      `\n${runtime}: ${result.checks.filter((c) => c.ok).length}/${result.checks.length} checks passed in ${elapsedSince(startedAt)}ms`,
    )
    results.push(result)
  }

  printReport(results)

  const failures = parityFailures(results)
  const failed = results.flatMap((result) =>
    result.checks
      .filter((check) => !check.ok)
      .map((check) => `${result.runtime}: ${check.name} — ${check.detail}`),
  )

  if (args.jsonOut) {
    const summary = {
      head,
      database: databaseName,
      runtimes,
      results: results.map((result) => ({
        runtime: result.runtime,
        passed: result.checks.filter((c) => c.ok).length,
        total: result.checks.length,
        checks: result.checks,
      })),
      parityFailures: failures,
    }
    await writeFile(args.jsonOut, `${JSON.stringify(summary, null, 2)}\n`)
    console.log(`\nwrote ${args.jsonOut}`)
  }

  if (!args.keep) await rm(scratchRoot, { recursive: true, force: true })
  else console.log(`\nkept scratch at ${scratchRoot}`)

  if (failed.length > 0 || failures.length > 0) {
    console.error('\nFAILED')
    for (const failure of [...failed, ...failures])
      console.error(`  ${failure}`)
    process.exitCode = 1
    return
  }
  console.log('\nAll requested runtimes passed every check.')
}

main().catch((error) => {
  if (
    error instanceof LifecycleError ||
    error instanceof ProvisionError ||
    (error && typeof error.code === 'string')
  ) {
    console.error(`${error.code}: ${error.message}`)
    process.exitCode = 2
    return
  }
  console.error(error)
  process.exitCode = 1
})
