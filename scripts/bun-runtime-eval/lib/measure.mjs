/*
 * Running one measured runtime: spawn, warm up, sweep, sample, tear down.
 *
 * The measurement is paired and alternating by construction: the caller runs
 * the two compiled rows in both orders across rounds, and this module makes
 * each individual run self-describing so a reader can tell a quiet window from
 * a contended one without trusting the summary table.
 *
 * Three things are recorded that the first version of the study did not:
 *
 *   - an interval sampler over the whole sweep, so peak memory is an observed
 *     series rather than the maximum of a handful of boundary reads;
 *   - the load generator's own CPU next to the server's, so "bounded load with
 *     generator headroom" is a number, not an assertion;
 *   - the neighbour CPU report for the window, so a run where another Obiter
 *     unit worked is marked contended rather than quietly averaged in.
 */
import { cpus, freemem, loadavg, totalmem } from 'node:os'
import { performance } from 'node:perf_hooks'
import {
  activeObiterUnits,
  busyFraction,
  contendedUnits,
  hostCpuTicks,
  neighbourReport,
  neighbourUsage,
} from '../../load/host-observation.mjs'
import { buildJourneyMatrix } from './journeys.mjs'
import { startTreeSampler, sampleTree } from './proc.mjs'
import { startServer, stopServer } from './server.mjs'
import { summarise } from './stats.mjs'

/** A never-real unit name, so every running Obiter unit counts as a neighbour. */
export const NEIGHBOUR_PROBE_UNIT = 'obiter-bun-eval-probe.service'

const round2 = (value) => Math.round(value * 100) / 100

export async function runJourney(journey) {
  const results = []
  const errors = []
  let next = 0
  const worker = async () => {
    while (next < journey.requests) {
      next += 1
      try {
        const result = await journey.run()
        results.push(result)
        if (result.status < 200 || result.status >= 400)
          errors.push(`${journey.name}: HTTP ${result.status}`)
      } catch (error) {
        errors.push(
          `${journey.name}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }
  const started = performance.now()
  await Promise.all(Array.from({ length: journey.concurrency }, worker))
  const elapsedMs = performance.now() - started
  const latencies = results.map((result) => result.ms)
  return {
    name: journey.name,
    requests: journey.requests,
    defaultRequests: journey.defaultRequests ?? journey.requests,
    concurrency: journey.concurrency,
    warmupRequests: Math.min(3, journey.requests),
    samples: latencies.length,
    latency: summarise(latencies),
    throughputPerSecond: round2((latencies.length / elapsedMs) * 1000),
    errors,
    bytes: results.reduce((sum, result) => sum + (result.bytes ?? 0), 0),
    note: results.find((result) => result.note)?.note ?? null,
  }
}

export async function measureRuntime({
  runtime,
  port,
  outDir,
  ids,
  fixtures,
  documentId,
  versionId,
  textDocumentId,
  settleMs,
  journeyFilter,
  journeyCounts,
  rssIntervalMs,
}) {
  const server = await startServer({
    runtime,
    port,
    logPath: `${outDir}/${runtime}-${Date.now()}.log`,
    settleMs,
  })
  const neighboursBefore = await neighbourUsage(NEIGHBOUR_PROBE_UNIT)
  const cpuTicksBefore = await hostCpuTicks()
  const hostBefore = {
    freeMb: Math.round(freemem() / 1048576),
    load: loadavg().map(round2),
  }
  const matrix = buildJourneyMatrix({
    origin: server.origin,
    ids,
    fixtures,
    documentId,
    versionId,
    textDocumentId,
    counts: journeyCounts,
  })
  const journeys = journeyFilter
    ? matrix.filter((journey) => journeyFilter.includes(journey.name))
    : matrix

  const cpuStart = await sampleTree(server.child.pid)
  const driverCpuStart = process.cpuUsage()
  const sampler = startTreeSampler(server.child.pid, {
    intervalMs: rssIntervalMs,
  }).start()

  const results = []
  for (const journey of journeys) {
    // Warm-up: the first request on a journey pays connection setup and any
    // lazily-built statement cache, which is start-up behaviour rather than
    // sustained handling.
    for (let i = 0; i < Math.min(3, journey.requests); i += 1)
      await journey.run().catch(() => {})
    results.push(await runJourney(journey))
  }

  const sampling = await sampler.stop()
  const cpuEnd = await sampleTree(server.child.pid)
  const driverCpu = process.cpuUsage(driverCpuStart)
  const hostAfter = {
    freeMb: Math.round(freemem() / 1048576),
    load: loadavg().map(round2),
  }
  const cpuTicksAfter = await hostCpuTicks()
  const neighboursAfter = await neighbourUsage(NEIGHBOUR_PROBE_UNIT)
  const hostBusy = busyFraction(cpuTicksBefore, cpuTicksAfter)
  const hostBusyVerdict =
    hostBusy < 0.25
      ? 'too_quiet_to_be_this_run'
      : hostBusy > 0.95
        ? 'contended'
        : 'ok'
  const serverCpuMs =
    cpuStart.cpuMs === null ? null : cpuEnd.cpuMs - cpuStart.cpuMs
  const driverCpuMs = Math.round((driverCpu.user + driverCpu.system) / 1000)
  const driverShare =
    serverCpuMs && serverCpuMs > 0
      ? round2(driverCpuMs / (driverCpuMs + serverCpuMs))
      : null

  await stopServer(server)
  return {
    runtime,
    transform: server.spec.transform,
    command: `${server.spec.command} ${server.spec.args.join(' ')}`,
    readyMs: round2(server.readyMs),
    idleRssMb: server.idleRssKb ? round2(server.idleRssKb / 1024) : null,
    // Observed sampled peak, not a guaranteed maximum. The sampler metadata
    // says how often it looked and for how long.
    peakSampledRssMb:
      sampling.peakSampledRssKb === null
        ? null
        : round2(sampling.peakSampledRssKb / 1024),
    sampling,
    cpuMs: serverCpuMs,
    driverCpuMs,
    // The load generator must not be the bottleneck: a share near 0.5 would
    // mean the harness, not the runtime, set the pace.
    driverCpuShare: driverShare,
    generatorHeadroomVerdict:
      driverShare === null
        ? 'unknown'
        : driverShare < 0.35
          ? 'ok'
          : driverShare < 0.5
            ? 'marginal'
            : 'driver_bound',
    journeys: results,
    hostBefore,
    hostAfter,
    hostBusyFraction: round2(hostBusy * 10000) / 10000,
    hostBusyVerdict,
    neighbours: {
      unitsAtStart: activeObiterUnits(),
      report: neighbourReport(neighboursBefore, neighboursAfter),
    },
    neighbourContended: contendedUnits(
      neighboursBefore,
      neighboursAfter,
      1000,
    ).map((entry) => entry.name),
    log: server.log.slice(-12),
  }
}

/** Host facts recorded once per campaign, for the report's provenance block. */
export function hostFacts() {
  return {
    vcpus: cpus().length,
    totalMemMb: Math.round(totalmem() / 1048576),
    node: process.version,
  }
}
