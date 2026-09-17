#!/usr/bin/env node
/*
 * Measure the upload/extraction envelope of one lane's API, and what extraction
 * concurrency does to unrelated authenticated requests.
 *
 * This is a manual instrument, not a gate. It publishes an observed envelope
 * with its conditions and its limitations; it does not assert a production
 * capacity, and no result from one server run should be turned into a CI
 * threshold.
 *
 * Usage (from the lane worktree, with that lane's API running):
 *
 *   node scripts/load/upload-extraction-load.mjs \
 *     --sizes small,medium --ramp 1,2,4 --requests 12 --duration-ms 20000 \
 *     --out /tmp/q3-upload-extraction.json
 *
 * See scripts/load/README.md for what each bound means, what the harness
 * refuses, and how to read the report.
 */
import { writeFile } from 'node:fs/promises'
import { loadavg } from 'node:os'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import {
  assertNeighboursQuiet,
  busyFraction,
  contendedUnits,
  createHostObserver,
  hostCpuTicks,
  neighbourReport,
  neighbourUsage,
  resolveUnitCgroup,
} from './host-observation.mjs'
import { runLoad } from './runner.mjs'
import { createHttpTransport } from './http-transport.mjs'
import {
  DOCX_CONTENT_TYPE,
  FixtureError,
  buildFixtures,
  fixtureFilename,
} from './fixtures.mjs'
import {
  ProvisionError,
  createQuerier,
  createScratchDirectory,
  fixtureIds,
  newRunTag,
  provisionFixtures,
  removeScratchDirectory,
  softDeleteFixtures,
  verifyIsolation,
  verifyRun,
  versionRowsSql,
} from './provision.mjs'
import { TargetRefusal, resolveLoadTarget } from './target.mjs'
import {
  UsageError,
  assertOutPathOutsideCheckout,
  buildCells,
  parseArgs,
} from './plan.mjs'
import {
  EXIT_OK,
  buildReport,
  decideExitCode,
  printSummary,
  refusalReport,
} from './report.mjs'
import { WORKTREE_ROOT, headSha } from '../../apps/web/lane-target.mjs'

const EXIT_REFUSED = 2
const EXIT_HARNESS_ERROR = 3

export async function main({
  argv = process.argv.slice(2),
  writeReport = writeFile,
} = {}) {
  const options = parseArgs(argv)
  if (!options.out) throw new UsageError('--out <path> is required')

  const worktreeRoot = options.expectCheckout ?? WORKTREE_ROOT
  const outPath = assertOutPathOutsideCheckout(options.out, worktreeRoot)
  const cells = buildCells(options)
  const unitName = `obiter-${basename(worktreeRoot)}-api`

  const target = await resolveLoadTarget({
    worktreeRoot,
    expectCommit: options.expectCommit ?? headSha(worktreeRoot) ?? undefined,
    allowDatabase: options.allowDatabase,
  })

  const runTag = newRunTag()
  const ids = fixtureIds(runTag)
  const querier = createQuerier({ databaseUrl: target.databaseUrl })
  // Created inside the try, so a failure anywhere in setup still runs the
  // cleanup that removes it.
  let scratch = null
  const controller = new AbortController()
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      console.error(`\n${signal}: stopping the run and cleaning up.`)
      controller.abort()
    })

  let fixtures = []
  let provisioned = null
  let sqlWritten = false
  let cleanup = { softDeletedMatters: [], failed: false }
  let fixturesDeleted = false
  let report = null
  let exitCode = EXIT_OK

  /**
   * Soft-delete both fixture matters through the product's own routes. Safe to
   * call twice, and called from the failure path too: a refusal that happens
   * after provisioning must not leave a matter full of synthetic documents
   * behind for someone else's run to trip over.
   */
  async function deleteFixtures() {
    if (fixturesDeleted) return
    // `provisioned` is null when provisioning itself failed, but the SQL
    // fixtures (including tenant B's matter) may already exist, so the base
    // ids are the fallback rather than a reason to skip cleanup.
    try {
      const softDeletedMatters = await softDeleteFixtures({
        target,
        ids: provisioned ?? ids,
      })
      cleanup = {
        softDeletedMatters,
        failed: softDeletedMatters.some(
          (entry) => entry.status !== 200 && entry.status !== 404,
        ),
      }
    } catch {
      cleanup = { softDeletedMatters: [], failed: true }
    }
    fixturesDeleted = true
  }

  try {
    scratch = await createScratchDirectory()
    fixtures = await buildFixtures({
      sizes: [...new Set(cells.map((cell) => cell.size))],
      outDir: scratch,
      maxBytes: options.maxFixtureBytes,
    })

    provisioned = await provisionFixtures({
      target,
      querier,
      ids,
      onSqlWritten: () => {
        sqlWritten = true
      },
    })
    const preExistingVersions = querier.rows(
      versionRowsSql(provisioned.matterId),
    ).length
    const isolation = await verifyIsolation({ target, ids: provisioned })

    const cgroupPath = await resolveUnitCgroup(unitName)
    const observer = createHostObserver({ cgroupPath, diskPath: worktreeRoot })
    const baseline = await observer.sample()
    // Captured either side of the load, not at report time: a 1-minute load
    // average read twice afterwards would describe nothing.
    const loadAverageBefore = loadavg()
    const hostCpuBefore = await hostCpuTicks()
    const neighboursBefore = await neighbourUsage(`${unitName}.service`)
    await assertNeighboursQuiet({
      unitName,
      before: neighboursBefore,
      windowMs: options.bounds.neighbourWindowMs,
      maxCpuMs: options.bounds.maxNeighbourCpuMs,
    })

    const loopDelay = monitorEventLoopDelay({ resolution: 20 })
    loopDelay.enable()
    const load = options.checkOnly
      ? checkOnlyLoad(cells)
      : await runLoad({
          cells: cells.map((cell) => ({
            fixture: findFixture(fixtures, cell.size),
            ...cell,
          })),
          transport: createHttpTransport({
            apiOrigin: target.apiOrigin,
            token: provisioned.sessionToken,
            matterId: provisioned.matterId,
            fixtureFilename,
            contentType: DOCX_CONTENT_TYPE,
          }),
          observer,
          bounds: options.bounds,
          signal: controller.signal,
          log: (line) => console.error(`[load] ${line}`),
        })
    loopDelay.disable()
    const neighboursAfter = await neighbourUsage(`${unitName}.service`)
    const neighbours = neighbourReport(neighboursBefore, neighboursAfter)
    const contended =
      contendedUnits(
        neighboursBefore,
        neighboursAfter,
        options.bounds.maxWindowNeighbourCpuMs,
      ).length > 0
    if (neighbours.some((entry) => entry.counterReset))
      console.error(
        'note: an Obiter unit restarted during the window, so its CPU over the window is reported as unknown.',
      )
    if (contended)
      console.error(
        'contended: another Obiter unit used significant CPU during the window; these numbers do not describe this lane alone.',
      )

    const expectedReady = load.perCell.reduce(
      (sum, cell) => sum + cell.counts.ok,
      0,
    )
    const verification = await verifyRun({
      querier,
      ids: provisioned,
      worktreeRoot,
      expectedReady,
    })

    await deleteFixtures()

    report = buildReport({
      options,
      target,
      unitName,
      cgroupPath,
      cells,
      fixtures,
      runTag,
      load,
      verification,
      isolation,
      preExistingVersions,
      baseline,
      loopDelay,
      neighbours,
      contended,
      hostLoad: {
        before: loadAverageBefore,
        after: loadavg(),
        cpuBusyFractionDuringWindow: busyFraction(
          hostCpuBefore,
          await hostCpuTicks(),
        ),
      },
      cleanup,
      worktreeRoot,
    })
    exitCode = decideExitCode({
      options,
      load,
      verification,
      isolation,
      contended,
    })
  } catch (error) {
    await deleteFixtures()
    throw error
  } finally {
    if (scratch) await removeScratchDirectory(scratch)
    await writeReport(
      outPath,
      `${JSON.stringify(report ?? refusalReport(), null, 2)}\n`,
    )
    if ((sqlWritten || provisioned) && (!fixturesDeleted || cleanup.failed)) {
      // Say exactly what remains rather than let a reader assume the run
      // cleaned up after itself.
      console.error(
        `retained for run tag ${runTag}: synthetic organisation, user, session and matter rows ` +
          '(soft delete did not complete); audit rows and stored objects are retained by design',
      )
    }
  }

  printSummary(report)
  console.error(`report: ${outPath}`)
  return exitCode
}

function checkOnlyLoad(cells) {
  return {
    skipped: cells.map((cell) => ({ ...cell, reason: 'check_only' })),
    perCell: [],
    uploads: [],
    probes: [],
    cancelled: false,
    samplerErrors: 0,
  }
}

function findFixture(fixtures, size) {
  const fixture = fixtures.find((entry) => entry.size === size)
  if (!fixture)
    throw new FixtureError(
      'fixture_missing',
      `No "${size}" fixture was generated.`,
    )
  return fixture
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (invokedDirectly)
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((error) => {
      const refusal =
        error instanceof TargetRefusal ||
        error instanceof ProvisionError ||
        error instanceof FixtureError ||
        error instanceof UsageError
      if (refusal) {
        console.error(`refused: ${error.message}`)
        process.exitCode = EXIT_REFUSED
        return
      }
      console.error(error)
      process.exitCode = EXIT_HARNESS_ERROR
    })
