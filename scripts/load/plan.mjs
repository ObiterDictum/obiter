/*
 * What one run will do, decided before any request is sent.
 *
 * `parseArgs`, `buildCells` and the report-path rule are pure: the plan a run
 * executes can be asserted in a test, and the bounds that keep a plan small are
 * enforced here rather than discovered mid-run.
 */
import { resolve, sep } from 'node:path'
import { DEFAULT_BOUNDS } from './bounds.mjs'

export class UsageError extends Error {}

const DEFAULT_SIZES = ['small', 'medium']
const MAX_CELLS = 8
const MAX_CONCURRENCY = 4

export function parseArgs(argv) {
  const options = {
    sizes: DEFAULT_SIZES,
    ramp: [1, 2],
    requests: 8,
    durationMs: 20_000,
  }
  const valueFlags = {
    '--sizes': (value) => {
      options.sizes = value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    },
    '--ramp': (value) => {
      options.ramp = value.split(',').map((part) => Number(part.trim()))
    },
    '--concurrency': (value) => {
      options.ramp = [Number(value)]
    },
    '--requests': (value) => {
      options.requests = Number(value)
    },
    '--duration-ms': (value) => {
      options.durationMs = Number(value)
    },
    '--out': (value) => {
      options.out = value
    },
    '--expect-checkout': (value) => {
      options.expectCheckout = resolve(value)
    },
    '--expect-commit': (value) => {
      options.expectCommit = value
    },
    '--allow-database': (value) => {
      options.allowDatabase = value
    },
    '--max-fixture-bytes': (value) => {
      options.maxFixtureBytes = Number(value)
    },
  }
  const boundFlags = {
    '--max-p95-ms': 'maxP95Ms',
    '--min-available-mb': 'minAvailableMb',
    '--min-free-disk-mb': 'minFreeDiskMb',
    '--max-rss-growth-mb': 'maxRssGrowthMb',
    '--max-consecutive-errors': 'maxConsecutiveErrors',
    '--max-error-rate': 'maxErrorRate',
    '--max-cell-duration-ms': 'maxCellDurationMs',
    '--idle-ms': 'idleMs',
    '--recovery-ms': 'recoveryMs',
    '--probe-interval-ms': 'probeIntervalMs',
    '--request-timeout-ms': 'requestTimeoutMs',
    '--max-neighbour-cpu-ms': 'maxNeighbourCpuMs',
    '--max-window-neighbour-cpu-ms': 'maxWindowNeighbourCpuMs',
  }
  const bounds = { ...DEFAULT_BOUNDS }
  const unexpected = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--check-only') {
      options.checkOnly = true
      continue
    }
    if (valueFlags[token]) {
      const value = argv[index + 1]
      if (value === undefined) throw new UsageError(`${token} needs a value`)
      valueFlags[token](value)
      index += 1
      continue
    }
    if (boundFlags[token]) {
      const value = Number(argv[index + 1])
      if (!Number.isFinite(value))
        throw new UsageError(`${token} needs a number`)
      bounds[boundFlags[token]] = value
      index += 1
      continue
    }
    unexpected.push(token)
  }
  if (unexpected.length > 0)
    throw new UsageError(`unexpected argument: ${unexpected[0]}`)
  return { ...options, bounds }
}

/** Cells are the size × concurrency product, in escalation order, bounded. */
export function buildCells({ sizes, ramp, requests, durationMs }) {
  if (sizes.length === 0) throw new UsageError('--sizes selected no fixture')
  if (ramp.length === 0) throw new UsageError('--ramp selected no concurrency')
  for (const concurrency of ramp)
    if (
      !Number.isInteger(concurrency) ||
      concurrency < 1 ||
      concurrency > MAX_CONCURRENCY
    )
      throw new UsageError(
        `concurrency ${concurrency} is out of range: this slice runs 1, 2 or 4 concurrent uploads and nothing above.`,
      )
  if (!Number.isInteger(requests) || requests < 1 || requests > 64)
    throw new UsageError('--requests must be an integer between 1 and 64')
  if (!Number.isFinite(durationMs) || durationMs < 1000)
    throw new UsageError('--duration-ms must be at least 1000')

  const cells = sizes.flatMap((size) =>
    [...ramp]
      .sort((left, right) => left - right)
      .map((concurrency) => ({
        size,
        concurrency,
        requests,
        durationMs,
      })),
  )
  if (cells.length > MAX_CELLS)
    throw new UsageError(
      `${cells.length} cells exceeds the ${MAX_CELLS}-cell bound for one run; narrow --sizes or --ramp.`,
    )
  return cells
}

/** Reports stay out of the repository: they are run dumps, not source. */
export function assertOutPathOutsideCheckout(outPath, worktreeRoot) {
  const resolved = resolve(outPath)
  if (resolved === worktreeRoot || resolved.startsWith(`${worktreeRoot}${sep}`))
    throw new UsageError(
      `--out ${resolved} is inside the checkout. Write run reports to a scratch path such as /tmp.`,
    )
  return resolved
}
