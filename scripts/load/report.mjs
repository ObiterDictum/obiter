/*
 * The run report: one JSON document carrying its own provenance, bounds,
 * results, verification and limitations, so a number cannot be read without the
 * conditions it was measured under.
 *
 * Also owns the exit code, because "what does this run's result mean" belongs in
 * exactly one place.
 */
import { cpus, release, totalmem } from 'node:os'
import { summarise } from './metrics.mjs'
import { activeObiterUnits, resourceSummary } from './host-observation.mjs'

export const EXIT_OK = 0
export const EXIT_RUN_FAILED = 1

export const LIMITATIONS = [
  'One API process, one Postgres, one machine. Nothing here predicts multi-instance or production topology.',
  'The measuring client shares the host with the server, so client CPU competes with extraction CPU as concurrency rises.',
  'Response latency is upload + storage + extraction + JSON in one request: extraction is inline, so no boundary inside that span is observable from outside the process.',
  'The API server’s own event-loop lag is not observable externally; only the driver’s is recorded, and probe latency stands in for server-side stalls.',
  'p95 over a small request count is a direction, not a distribution. Cells are bounded deliberately and the sample count is reported with every percentile.',
  'Redaction-model inference, document save and edit, comments, export and search ingest are outside this slice and were not loaded.',
]

export function buildReport(context) {
  const { load, verification, isolation, options } = context
  const phase = (name) => load.probes.filter((probe) => probe.phase === name)
  const idle = summarise(phase('idle').map((probe) => probe.latencyMs))
  const recovery = summarise(phase('recovery').map((probe) => probe.latencyMs))
  return {
    harness: {
      name: 'obiter upload/extraction load harness',
      version: 1,
      worktreeRoot: context.worktreeRoot,
      laneUnit: context.unitName,
      runTag: context.runTag,
      reportPathOutsideCheckout: true,
    },
    provenance: {
      apiOrigin: context.target.apiOrigin,
      apiCheckoutRoot: context.target.health.provenance.checkoutRoot,
      apiCommitSha: context.target.health.provenance.commitSha,
      apiEnvFile: context.target.health.provenance.envFile,
      databaseName: context.target.databaseName,
      databaseSource: context.target.databaseSource,
      extentOfTie:
        'the provisioned session authenticated against this API, so the database psql wrote and the database the API reads are the same one',
    },
    environment: {
      node: process.version,
      kernel: release(),
      cpuModel: cpus()[0]?.model ?? null,
      cpuCount: cpus().length,
      memTotalBytes: totalmem(),
      apiCgroup: context.cgroupPath,
      apiBaseline: context.baseline,
      activeObiterUnits: activeObiterUnits(),
      neighbourLaneUsage: {
        units: context.neighbours,
        contendedDuringWindow: context.contended,
        contentionNote:
          'another lane on this 4-vCPU box during the load window makes the throughput numbers indicative, not comparable; a contended run exits non-zero',
      },
      hostLoadAverage: context.hostLoad,
      driverEventLoopDelayMs: {
        p50: round(nanosecondsToMs(context.loopDelay.percentile(50))),
        p99: round(nanosecondsToMs(context.loopDelay.percentile(99))),
        max: round(nanosecondsToMs(context.loopDelay.max)),
        note: 'the driver’s event loop only; the API server’s own lag is not observable from outside the process',
      },
    },
    methodology: {
      boundary:
        'one authenticated multipart upload per request: POST /api/matters/:id/documents',
      extraction:
        'inline in the upload request — the current implementation, unmodified by this harness',
      unrelatedProbe:
        'GET /api/matters — the matters list query the product issues on load',
      probeCadenceMs: options.bounds.probeIntervalMs,
      requestLatencyDefinition:
        'client wall clock around the whole request: transfer + storage + extraction + JSON',
      percentiles:
        'nearest-rank over recorded samples; the sample count is reported with every figure',
      sustainedEnvelopeRule:
        'the highest concurrency whose cell finished with no failures, no failed probes and no breached bound',
    },
    bounds: options.bounds,
    cellsRequested: context.cells,
    fixtures: context.fixtures.map(({ size, bytes, sha256, paragraphs }) => ({
      size,
      bytes,
      sha256,
      paragraphs,
    })),
    preExisting: {
      versionCountInMatterBeforeRun: context.preExistingVersions,
      note: 'the matter is created by this run, so every row in it is task-created',
    },
    results: load.perCell,
    skippedCells: load.skipped,
    cancelled: load.cancelled,
    /** Whether the API's memory came back after the load stopped, not only its latency. */
    recoveryResources: recoverySummary(load, context.baseline),
    probes: {
      idle,
      recovery,
      idleFailures: phase('idle').filter((probe) => !probe.ok).length,
      recoveryFailures: phase('recovery').filter((probe) => !probe.ok).length,
      recoveryOverIdleP50:
        idle.p50 && recovery.p50 ? round(recovery.p50 / idle.p50) : null,
    },
    verification: {
      ...verification,
      note: 'read from Postgres and the API storage root after the run, not from response bodies',
    },
    privacyIsolation: isolation,
    cleanup: {
      softDeletedMatters: context.cleanup.softDeletedMatters,
      softDeleteFailed: context.cleanup.failed,
      retained: [
        'synthetic organisation, user and session rows',
        'audit rows (never modified or deleted by this harness)',
        'soft-deleted matter, document and version rows',
        'stored source and text objects under services/api/.obiter-storage',
      ],
      scratchDirectoryRemoved: true,
    },
    limitations: LIMITATIONS,
  }
}

export function decideExitCode({
  options,
  load,
  verification,
  isolation,
  contended,
}) {
  if (!isolation.allPassed) return EXIT_RUN_FAILED
  if (options.checkOnly) return EXIT_OK
  // A contended window measured the machine, not this lane.
  if (contended) return EXIT_RUN_FAILED
  if (load.cancelled || load.perCell.length === 0) return EXIT_RUN_FAILED
  if (load.perCell.some((cell) => !cell.accepted)) return EXIT_RUN_FAILED
  if (!verification.readyMatchesExpected) return EXIT_RUN_FAILED
  if (!verification.allStoragePresent) return EXIT_RUN_FAILED
  if (verification.documentsWithoutVersion > 0) return EXIT_RUN_FAILED
  if (verification.readyWithoutTextKey > 0) return EXIT_RUN_FAILED
  if (verification.duplicateDocumentIds.length > 0) return EXIT_RUN_FAILED
  if (verification.duplicateVersionNumbers.length > 0) return EXIT_RUN_FAILED
  return EXIT_OK
}

function recoverySummary(load, baseline) {
  const summary = resourceSummary(baseline, load.recoverySamples ?? [])
  return {
    ...summary,
    apiAnonRetainedBytes: summary.apiAnonGrowthBytes,
    note: 'sampled across the recovery window after the last cell; a positive figure means the API had not returned to its pre-load anon by then',
  }
}

function nanosecondsToMs(value) {
  return Number.isFinite(value) ? value / 1e6 : null
}

function round(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 100) / 100
    : null
}

export function refusalReport() {
  return {
    refused: true,
    note: 'the run was refused before observations were recorded',
  }
}

export function printSummary(report) {
  if (!report?.results || report.results.length === 0) {
    console.log(
      `no cells ran${report?.skippedCells?.length ? `: ${report.skippedCells.length} skipped` : ''}`,
    )
    return
  }
  console.log(
    '\nfixture   conc  req  ok  fail  p50ms  p95ms  probeP50  probeP95  rssGrowthMB  accepted',
  )
  for (const cell of report.results)
    console.log(
      [
        cell.size.padEnd(9),
        String(cell.concurrency).padStart(4),
        String(cell.requestsIssued).padStart(4),
        String(cell.counts.ok).padStart(3),
        String(cell.failures).padStart(4),
        String(round(cell.latencyMs.p50)).padStart(6),
        String(round(cell.latencyMs.p95)).padStart(6),
        String(round(cell.probeDuring.p50)).padStart(8),
        String(round(cell.probeDuring.p95)).padStart(8),
        String(
          round((cell.resources.apiAnonGrowthBytes ?? 0) / 1024 / 1024),
        ).padStart(11),
        String(cell.accepted).padStart(9),
      ].join('  '),
    )
  if (report.skippedCells.length > 0)
    console.log(
      `skipped: ${report.skippedCells
        .map((cell) => `${cell.size}x${cell.concurrency} (${cell.reason})`)
        .join(', ')}`,
    )
  console.log(
    `verification: ${report.verification.readyCount}/${report.verification.expectedReady} ready, ` +
      `storage complete: ${report.verification.allStoragePresent}, isolation: ${report.privacyIsolation.allPassed}`,
  )
  console.log(
    `probe p50 idle ${round(report.probes.idle.p50)} ms -> recovery ${round(report.probes.recovery.p50)} ms`,
  )
}
