#!/usr/bin/env node
import { writeFile } from 'node:fs/promises'
import { loadavg } from 'node:os'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import {
  activeObiterUnits,
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
import { createQuerier } from './psql.mjs'
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
  const unitName = `obiter-${basename(worktreeRoot)}-api`

  const runTag = newRunTag()
  const ids = fixtureIds(runTag)
  let cells = []
  let target = null
  let querier = null
  let scratch = null
  const controller = new AbortController()

  let fixtures = []
  let provisioned = null
  let sqlWritten = false
  let cleanup = { softDeletedMatters: [], failed: false }
  let fixturesDeleted = false
  let report = null
  let failure = null
  let exitCode = EXIT_OK

  async function deleteFixtures() {
    if (fixturesDeleted || !target) return
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

  let signals = 0
  const onSignal = (signal) => {
    signals += 1
    if (signals > 1) {
      console.error(`${signal}: second signal, exiting without cleanup.`)
      process.exit(EXIT_HARNESS_ERROR)
    }
    console.error(`\n${signal}: stopping the run and cleaning up.`)
    controller.abort()
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, onSignal)

  try {
    cells = buildCells(options)
    target = await resolveLoadTarget({
      worktreeRoot,
      expectCommit: options.expectCommit ?? headSha(worktreeRoot) ?? undefined,
      allowDatabase: options.allowDatabase,
    })
    querier = createQuerier({ databaseUrl: target.databaseUrl })
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
    const baseline = await firstSample(observer)
    const loadAverageBefore = loadavg()
    const hostCpuBefore = await hostCpuTicks()
    const activeUnitsBefore = activeObiterUnits()
    const neighboursBefore = await neighbourUsage(`${unitName}.service`, {
      listUnits: () => activeUnitsBefore,
    })
    await assertNeighboursQuiet({
      unitName,
      before: neighboursBefore,
      windowMs: options.bounds.neighbourWindowMs,
      maxCpuMs: options.bounds.maxNeighbourCpuMs,
    })

    const loopDelay = monitorEventLoopDelay({ resolution: 20 })
    loopDelay.enable()
    const load = options.checkOnly
      ? checkOnlyLoad(cells, baseline)
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
    const activeUnitsAfter = activeObiterUnits()
    const neighboursAfter = await neighbourUsage(`${unitName}.service`, {
      listUnits: () => activeUnitsAfter,
    })
    const neighbours = neighbourReport(neighboursBefore, neighboursAfter)
    const contended =
      contendedUnits(
        neighboursBefore,
        neighboursAfter,
        options.bounds.maxWindowNeighbourCpuMs,
      ).length > 0
    if (
      neighbours.some(
        (entry) => entry.counterReset || entry.disappearedDuringWindow,
      )
    )
      console.error(
        'note: an Obiter unit restarted or stopped during the window, so its CPU over the window is reported as unknown.',
      )
    if (neighbours.some((entry) => entry.appearedDuringWindow))
      console.error(
        'note: an Obiter unit started during the window; that is activity the pre-run gate could not see.',
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
      storageRoot: target.storageRoot,
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
      activeUnits: activeUnitsBefore,
      activeUnitsAfter,
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
    failure = error
    await deleteFixtures()
  } finally {
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.removeListener(signal, onSignal)
    if (scratch) await removeScratchDirectory(scratch)
  }

  let writeError = null
  try {
    await writeReport(
      outPath,
      `${JSON.stringify(report ?? refusalReport(failure), null, 2)}\n`,
    )
  } catch (error) {
    writeError = error
    console.error(
      `could not write the report to ${outPath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if ((sqlWritten || provisioned) && (!fixturesDeleted || cleanup.failed)) {
    console.error(
      `retained for run tag ${runTag}: synthetic organisation, user, session and matter rows ` +
        '(soft delete did not complete); audit rows and stored objects are retained by design',
    )
  }
  if (failure) throw failure
  if (writeError) throw writeError

  printSummary(report)
  console.error(`report: ${outPath}`)
  return exitCode
}

function checkOnlyLoad(cells, baseline) {
  return {
    baselineResources: baseline,
    recoverySamples: [],
    skipped: cells.map((cell) => ({ ...cell, reason: 'check_only' })),
    perCell: [],
    uploads: [],
    probes: [],
    cancelled: false,
    samplerErrors: 0,
    observationCount: baseline ? 1 : 0,
  }
}

async function firstSample(observer) {
  try {
    return await observer.sample()
  } catch (error) {
    throw new TargetRefusal(
      'host_observation_failed',
      `The host/API observer could not take its first sample: ${error instanceof Error ? error.message : String(error)}. ` +
        'Without a baseline no resource bound or recovery comparison can be stated, so the run is refused.',
    )
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
