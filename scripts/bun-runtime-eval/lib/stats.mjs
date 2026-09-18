/*
 * Percentile and summary statistics for the runtime comparison.
 *
 * The method is nearest-rank: sort ascending and take index
 * ceil(fraction * n) - 1, clamped to the array. It is deliberately the
 * simplest defensible definition and it is recorded with every result so a
 * reader can re-derive the figure. Its consequence is that for n <= 19 the
 * 0.95 quantile *is* the maximum, so a p95 over 8-12 samples is a max
 * comparison, not an estimate of the tail. Results carry `n` and
 * `p95IsMax` so a table cannot silently present that as a tail statistic.
 */

/** Largest index <= fraction*n, i.e. nearest-rank. */
export function percentileIndex(n, fraction) {
  if (n <= 0) return -1
  return Math.min(n - 1, Math.max(0, Math.ceil(fraction * n) - 1))
}

export function percentile(sortedAscending, fraction) {
  if (sortedAscending.length === 0) return null
  return sortedAscending[percentileIndex(sortedAscending.length, fraction)]
}

export const round = (value) =>
  value === null || value === undefined ? null : Math.round(value * 100) / 100

/**
 * Summarise one journey's latency samples.
 *
 * `valuesMs` keeps the sorted raw samples so any reader can recompute p50/p95
 * and inspect the tail instead of trusting the summary. `p95IsMax` is an
 * explicit warning that the quantile degenerated to the sample maximum.
 */
export function summarise(samples) {
  const values = samples
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
  if (values.length === 0) return null
  const p95Index = percentileIndex(values.length, 0.95)
  return {
    count: values.length,
    method: 'nearest-rank ceil(fraction*n)',
    p50: round(percentile(values, 0.5)),
    p95: round(values[p95Index]),
    p95IsMax: p95Index === values.length - 1,
    min: round(values[0]),
    max: round(values[values.length - 1]),
    valuesMs: values.map(round),
  }
}

/** Ratio of a candidate to a baseline, as a signed percentage. */
export function deltaPercent(candidate, baseline) {
  if (
    !Number.isFinite(candidate) ||
    !Number.isFinite(baseline) ||
    baseline === 0
  )
    return null
  return round(((candidate - baseline) / baseline) * 100)
}
