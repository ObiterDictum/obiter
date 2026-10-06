/*
 * The per-cell record: what one fixture size at one concurrency produced.
 *
 * Shaped as data, with no clock and no I/O, so a cell's numbers can be asserted
 * directly from a test instead of being read out of a live run.
 */
import { countByCategory, summarise, throughputPerSecond } from './metrics.mjs'
import { countFailures } from './bounds.mjs'
import { resourceSummary } from './host-observation.mjs'

export function summariseCell({
  cell,
  index,
  cellUploads,
  duringProbes,
  loadMs,
  samples,
  baselineResources,
  abortReason,
  issued,
}) {
  const okLatencies = cellUploads
    .filter((entry) => entry.category === 'ok')
    .map((entry) => entry.latencyMs)
  const counts = countByCategory(cellUploads)
  const failures = countFailures(counts)
  return {
    index,
    size: cell.fixture.size,
    fixtureBytes: cell.fixture.bytes,
    fixtureSha256: cell.fixture.sha256,
    fixtureParagraphs: cell.fixture.paragraphs,
    concurrency: cell.concurrency,
    requestsRequested: cell.requests,
    requestsIssued: issued,
    durationMs: cell.durationMs,
    loadMs,
    counts,
    latencyMs: summarise(
      cellUploads
        .filter((entry) => entry.category !== 'cancelled')
        .map((entry) => entry.latencyMs),
    ),
    okLatencyMs: summarise(okLatencies),
    throughputPerSecond: throughputPerSecond(counts.ok, loadMs),
    firstLatencyMs: cellUploads[0]?.latencyMs ?? null,
    failures,
    probeDuring: summarise(duringProbes.map((entry) => entry.latencyMs)),
    probeFailures: duringProbes.filter((entry) => !entry.ok).length,
    // Per cell, not cumulative: the baseline is this cell's own first sample,
    // so `apiAnonGrowthBytes` and `apiCpuUsecDelta` describe what this cell did.
    // The run-level comparison against the pre-load baseline is
    // `recoverySamples`.
    resources: resourceSummary(samples[0] ?? baselineResources, samples),
    aborted: abortReason !== null,
    abortReason,
    accepted:
      abortReason === null &&
      failures === 0 &&
      duringProbes.every((entry) => entry.ok),
  }
}
