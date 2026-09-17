/*
 * The safety bounds that stop a load run, and the running totals they are
 * evaluated against.
 *
 * Resource bounds live in one place so the same rule both gates escalation
 * between cells and stops a cell mid-flight (P3: a guard on one path is a guard
 * on neither).
 */
import { countByCategory, summarise } from './metrics.mjs'

const MEGABYTE = 1024 * 1024

export const DEFAULT_BOUNDS = {
  minAvailableMb: 800,
  minFreeDiskMb: 2000,
  maxRssGrowthMb: 512,
  maxP95Ms: 60_000,
  maxConsecutiveErrors: 3,
  maxErrorRate: 0.5,
  maxCellDurationMs: 300_000,
  minSamplesForThresholds: 5,
  requestTimeoutMs: 120_000,
  probeTimeoutMs: 10_000,
  probeIntervalMs: 250,
  sampleIntervalMs: 500,
  tickIntervalMs: 250,
  idleMs: 3000,
  recoveryMs: 5000,
  // Another lane on the same four vCPUs makes a capacity number unusable, so
  // contention is a bound with a value, not a footnote. Measured over a short
  // quiet check before the load, and again across the whole window.
  neighbourWindowMs: 2500,
  maxNeighbourCpuMs: 1000,
  maxWindowNeighbourCpuMs: 5000,
}

/** The first breached resource bound, or null. */
export function resourceBreach(resources, bounds) {
  if (!resources) return null
  const { hostAvailableBytes, diskFreeBytes, apiAnonGrowthBytes } = resources
  if (
    hostAvailableBytes != null &&
    hostAvailableBytes < bounds.minAvailableMb * MEGABYTE
  )
    return {
      reason: 'host_memory',
      observed: bytesToMb(hostAvailableBytes),
      bound: bounds.minAvailableMb,
    }
  if (diskFreeBytes != null && diskFreeBytes < bounds.minFreeDiskMb * MEGABYTE)
    return {
      reason: 'disk_pressure',
      observed: bytesToMb(diskFreeBytes),
      bound: bounds.minFreeDiskMb,
    }
  if (
    apiAnonGrowthBytes != null &&
    apiAnonGrowthBytes > bounds.maxRssGrowthMb * MEGABYTE
  )
    return {
      reason: 'api_memory_growth',
      observed: bytesToMb(apiAnonGrowthBytes),
      bound: bounds.maxRssGrowthMb,
    }
  return null
}

/**
 * The first breached bound of any kind, or null. Latency and error-rate bounds
 * are gated on a sample count so a single slow first request cannot abort a
 * cell before it has measured anything.
 */
export function evaluateBounds(state, bounds) {
  if (state.elapsedMs >= bounds.maxCellDurationMs)
    return {
      reason: 'max_duration',
      observed: state.elapsedMs,
      bound: bounds.maxCellDurationMs,
    }

  const resource = resourceBreach(state.resources, bounds)
  if (resource) return resource

  const sampled = state.count >= bounds.minSamplesForThresholds
  if (sampled && state.p95Ms != null && state.p95Ms > bounds.maxP95Ms)
    return { reason: 'latency', observed: state.p95Ms, bound: bounds.maxP95Ms }
  if (state.consecutiveErrors >= bounds.maxConsecutiveErrors)
    return {
      reason: 'consecutive_errors',
      observed: state.consecutiveErrors,
      bound: bounds.maxConsecutiveErrors,
    }
  if (sampled && state.errorRate > bounds.maxErrorRate)
    return {
      reason: 'error_rate',
      observed: state.errorRate,
      bound: bounds.maxErrorRate,
    }
  return null
}

function bytesToMb(bytes) {
  return Math.round((bytes / MEGABYTE) * 10) / 10
}

/** Running totals the bounds are evaluated against. */
export function aggregate(cellUploads, elapsedMs, resources) {
  const counts = countByCategory(cellUploads)
  const failures = countFailures(counts)
  const rateable = counts.ok + failures
  let consecutiveErrors = 0
  for (let index = cellUploads.length - 1; index >= 0; index -= 1) {
    if (cellUploads[index].category === 'ok') break
    if (cellUploads[index].category !== 'cancelled') consecutiveErrors += 1
  }
  const latencies = cellUploads
    .filter((entry) => entry.category !== 'cancelled')
    .map((entry) => entry.latencyMs)
  return {
    elapsedMs,
    resources,
    count: rateable,
    successes: counts.ok,
    failures,
    consecutiveErrors,
    errorRate: rateable === 0 ? 0 : failures / rateable,
    p95Ms: summarise(latencies).p95,
  }
}

export function countFailures(counts) {
  return Object.entries(counts)
    .filter(([category]) => category !== 'ok' && category !== 'cancelled')
    .reduce((sum, [, count]) => sum + count, 0)
}
