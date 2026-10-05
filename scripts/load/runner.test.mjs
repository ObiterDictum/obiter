import { describe, expect, it } from 'bun:test'
import { DEFAULT_BOUNDS, evaluateBounds, resourceBreach } from './bounds.mjs'
import { runLoad } from './runner.mjs'

const fixture = {
  size: 'small',
  bytes: 1024,
  sha256: 'a'.repeat(64),
  paragraphs: 40,
  content: Buffer.alloc(0),
}

const quietBounds = {
  ...DEFAULT_BOUNDS,
  idleMs: 2,
  recoveryMs: 2,
  probeIntervalMs: 2,
  sampleIntervalMs: 2,
  tickIntervalMs: 2,
  maxCellDurationMs: 5000,
  minSamplesForThresholds: 3,
  maxConsecutiveErrors: 3,
  maxErrorRate: 1,
  maxP95Ms: 5000,
  requestTimeoutMs: 2000,
  probeTimeoutMs: 2000,
}

/** Waits `ms`, rejecting with an AbortError the moment the signal fires. */
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      },
      { once: true },
    )
  })
}

function readyResponse() {
  return {
    outcome: 'response',
    status: 201,
    body: {
      document: { id: `doc_${Math.random().toString(36).slice(2)}` },
      version: {
        id: `ver_${Math.random().toString(36).slice(2)}`,
        documentStatus: 'ready',
      },
    },
  }
}

function makeTransport({
  uploadMs = 0,
  probeMs = 0,
  uploadResponse = readyResponse,
  probeStatus = 200,
} = {}) {
  return {
    async upload(_fixture, { signal }) {
      if (uploadMs > 0) await wait(uploadMs, signal)
      return typeof uploadResponse === 'function'
        ? uploadResponse()
        : uploadResponse
    },
    async probe({ signal }) {
      if (probeMs > 0) await wait(probeMs, signal)
      return { outcome: 'response', status: probeStatus }
    },
  }
}

function makeObserver(samples) {
  let index = 0
  return {
    async sample() {
      const sample = samples[Math.min(index, samples.length - 1)]
      index += 1
      return sample
    },
  }
}

const healthySample = {
  apiAnonBytes: 300 * 1024 * 1024,
  apiMemoryCurrentBytes: 320 * 1024 * 1024,
  apiCpuUsec: 1000,
  hostAvailableBytes: 3000 * 1024 * 1024,
  diskFreeBytes: 20 * 1024 * 1024 * 1024,
}

function cellsFor(concurrency, requests, durationMs = 5000) {
  return [{ fixture, concurrency, requests, durationMs }]
}

describe('resource bounds', () => {
  it('treats an unavailable reading as no breach rather than zero growth', () => {
    expect(resourceBreach(null, DEFAULT_BOUNDS)).toBeNull()
    expect(
      resourceBreach(
        {
          hostAvailableBytes: null,
          diskFreeBytes: null,
          apiAnonGrowthBytes: null,
        },
        DEFAULT_BOUNDS,
      ),
    ).toBeNull()
  })

  it('names the breached host bound', () => {
    expect(
      resourceBreach(
        {
          hostAvailableBytes: 100 * 1024 * 1024,
          diskFreeBytes: null,
          apiAnonGrowthBytes: null,
        },
        { ...DEFAULT_BOUNDS, minAvailableMb: 800 },
      ).reason,
    ).toBe('host_memory')
    expect(
      resourceBreach(
        { diskFreeBytes: 1 },
        { ...DEFAULT_BOUNDS, minFreeDiskMb: 2000 },
      ).reason,
    ).toBe('disk_pressure')
    expect(
      resourceBreach(
        { apiAnonGrowthBytes: 600 * 1024 * 1024 },
        { ...DEFAULT_BOUNDS, maxRssGrowthMb: 512 },
      ).reason,
    ).toBe('api_memory_growth')
  })
})

describe('evaluateBounds', () => {
  it('aborts on the wall-clock ceiling regardless of sample count', () => {
    expect(
      evaluateBounds(
        { elapsedMs: 10, count: 0 },
        { ...DEFAULT_BOUNDS, maxCellDurationMs: 5 },
      ).reason,
    ).toBe('max_duration')
  })

  it('does not judge latency or error rate before enough samples', () => {
    const state = {
      elapsedMs: 1,
      count: 1,
      p95Ms: 99_999,
      errorRate: 1,
      consecutiveErrors: 0,
    }
    expect(
      evaluateBounds(state, {
        ...DEFAULT_BOUNDS,
        minSamplesForThresholds: 5,
        maxConsecutiveErrors: 99,
      }),
    ).toBeNull()
  })

  it('aborts on consecutive errors without waiting for a sample count', () => {
    const state = {
      elapsedMs: 1,
      count: 1,
      p95Ms: 1,
      errorRate: 1,
      consecutiveErrors: 3,
    }
    expect(
      evaluateBounds(state, {
        ...DEFAULT_BOUNDS,
        maxConsecutiveErrors: 3,
        maxErrorRate: 1,
      }).reason,
    ).toBe('consecutive_errors')
  })
})

describe('runLoad accounting', () => {
  it('issues exactly the requested count, not concurrency times that count', async () => {
    for (const concurrency of [1, 2, 4]) {
      const result = await runLoad({
        cells: cellsFor(concurrency, 5),
        transport: makeTransport({ uploadMs: 1 }),
        bounds: quietBounds,
      })
      expect(result.uploads).toHaveLength(5)
      expect(result.perCell[0].counts.ok).toBe(5)
      expect(result.perCell[0].requestsIssued).toBe(5)
      expect(result.perCell[0].accepted).toBe(true)
    }
  })

  it('stops issuing at the duration bound', async () => {
    const result = await runLoad({
      cells: cellsFor(1, 50, 40),
      transport: makeTransport({ uploadMs: 10 }),
      bounds: quietBounds,
    })
    expect(result.perCell[0].requestsIssued).toBeLessThan(50)
    expect(result.perCell[0].requestsIssued).toBeGreaterThan(0)
  })

  it('does not count a failed extraction as throughput', async () => {
    const result = await runLoad({
      cells: cellsFor(1, 3),
      transport: makeTransport({
        uploadMs: 1,
        uploadResponse: () => ({
          outcome: 'response',
          status: 201,
          body: {
            document: { id: 'doc_1' },
            version: {
              id: 'ver_1',
              documentStatus: 'failed',
              failureReason: 'could not be read',
            },
          },
        }),
      }),
      bounds: { ...quietBounds, maxConsecutiveErrors: 99 },
    })
    const cell = result.perCell[0]
    expect(cell.counts.ok).toBe(0)
    expect(cell.counts.extraction_failed).toBe(3)
    expect(cell.failures).toBe(3)
    expect(cell.throughputPerSecond).toBe(0)
    expect(cell.accepted).toBe(false)
  })

  it('records probe latency per phase and fails the cell when a probe is not 200', async () => {
    const result = await runLoad({
      cells: cellsFor(1, 1),
      transport: makeTransport({ uploadMs: 5, probeStatus: 503 }),
      bounds: { ...quietBounds, idleMs: 10, recoveryMs: 10 },
    })
    const phases = new Set(result.probes.map((probe) => probe.phase))
    expect(phases.has('idle')).toBe(true)
    expect(phases.has('during')).toBe(true)
    expect(phases.has('recovery')).toBe(true)
    expect(result.perCell[0].probeFailures).toBeGreaterThan(0)
    expect(result.perCell[0].accepted).toBe(false)
  })
})

describe('runLoad safety stops', () => {
  it('aborts on consecutive errors', async () => {
    const result = await runLoad({
      cells: cellsFor(1, 20),
      transport: makeTransport({
        uploadMs: 2,
        uploadResponse: () => ({
          outcome: 'response',
          status: 500,
          body: null,
        }),
      }),
      bounds: { ...quietBounds, maxConsecutiveErrors: 3 },
    })
    const cell = result.perCell[0]
    expect(cell.aborted).toBe(true)
    expect(cell.abortReason.reason).toBe('consecutive_errors')
    expect(cell.requestsIssued).toBeLessThan(20)
    expect(cell.accepted).toBe(false)
  })

  it('aborts on latency over the bound', async () => {
    const result = await runLoad({
      cells: cellsFor(1, 20),
      transport: makeTransport({ uploadMs: 25 }),
      bounds: { ...quietBounds, maxP95Ms: 10, minSamplesForThresholds: 3 },
    })
    const cell = result.perCell[0]
    expect(cell.aborted).toBe(true)
    expect(cell.abortReason.reason).toBe('latency')
  })

  it('aborts on host memory pressure', async () => {
    const result = await runLoad({
      cells: cellsFor(1, 10),
      transport: makeTransport({ uploadMs: 5 }),
      // Healthy for the baseline and the escalation gate, pressured once the
      // cell is running: the abort has to come from the tick, not the gate.
      observer: makeObserver([
        healthySample,
        healthySample,
        { ...healthySample, hostAvailableBytes: 100 * 1024 * 1024 },
      ]),
      bounds: { ...quietBounds, minAvailableMb: 800 },
    })
    const cell = result.perCell[0]
    expect(cell.aborted).toBe(true)
    expect(cell.abortReason.reason).toBe('host_memory')
  })

  it('refuses to start a cell when the headroom is already gone', async () => {
    const result = await runLoad({
      cells: cellsFor(1, 5),
      transport: makeTransport(),
      observer: makeObserver([{ ...healthySample, diskFreeBytes: 1024 }]),
      bounds: { ...quietBounds, minFreeDiskMb: 2000 },
    })
    expect(result.perCell).toHaveLength(0)
    expect(result.uploads).toHaveLength(0)
    expect(result.skipped).toEqual([
      { concurrency: 1, size: 'small', reason: 'disk_pressure' },
    ])
  })

  it('marks cancellation as cancelled rather than as a failure', async () => {
    const controller = new AbortController()
    const running = runLoad({
      cells: cellsFor(2, 20),
      transport: makeTransport({ uploadMs: 40 }),
      bounds: quietBounds,
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 15)
    const settled = await running
    expect(settled.cancelled).toBe(true)
    expect(settled.perCell[0].failures).toBe(0)
    expect(settled.uploads.length).toBeGreaterThan(0)
    expect(
      settled.uploads.every((entry) => entry.category === 'cancelled'),
    ).toBe(true)
  })

  it('stops after an aborted cell instead of escalating to the next one', async () => {
    const result = await runLoad({
      cells: [
        { fixture, concurrency: 1, requests: 10, durationMs: 5000 },
        { fixture, concurrency: 4, requests: 10, durationMs: 5000 },
      ],
      transport: makeTransport({
        uploadMs: 2,
        uploadResponse: () => ({
          outcome: 'response',
          status: 500,
          body: null,
        }),
      }),
      bounds: { ...quietBounds, maxConsecutiveErrors: 2 },
    })
    expect(result.perCell).toHaveLength(1)
    expect(result.perCell[0].aborted).toBe(true)
  })

  it('measures recovery after the load and reports it against idle', async () => {
    const result = await runLoad({
      cells: cellsFor(1, 2),
      transport: makeTransport({ uploadMs: 5, probeMs: 1 }),
      bounds: { ...quietBounds, idleMs: 20, recoveryMs: 20 },
    })
    const idle = result.probes.filter((probe) => probe.phase === 'idle')
    const recovery = result.probes.filter((probe) => probe.phase === 'recovery')
    expect(idle.length).toBeGreaterThan(0)
    expect(recovery.length).toBeGreaterThan(0)
    expect(result.probes.every((probe) => probe.status === 200)).toBe(true)
  })
})

describe('recovery sampling', () => {
  it('samples resources across the recovery window, not only during the load', async () => {
    const samples = [
      healthySample,
      { ...healthySample, apiAnonBytes: 400 * 1024 * 1024 },
      { ...healthySample, apiAnonBytes: 500 * 1024 * 1024 },
      { ...healthySample, apiAnonBytes: 620 * 1024 * 1024 },
    ]
    const result = await runLoad({
      cells: cellsFor(1, 2),
      transport: makeTransport({ uploadMs: 2 }),
      observer: makeObserver(samples),
      bounds: {
        ...quietBounds,
        idleMs: 2,
        recoveryMs: 30,
        sampleIntervalMs: 2,
      },
    })
    expect(result.recoverySamples.length).toBeGreaterThan(0)
    expect(result.baselineResources.apiAnonBytes).toBe(samples[0].apiAnonBytes)
  })

  it('records no recovery samples without an observer rather than inventing them', async () => {
    const result = await runLoad({
      cells: cellsFor(1, 1),
      transport: makeTransport(),
      bounds: { ...quietBounds, idleMs: 2, recoveryMs: 2 },
    })
    expect(result.recoverySamples).toEqual([])
    expect(result.perCell[0].resources.apiAnonGrowthBytes).toBeNull()
  })
})

describe('per-cell resource attribution', () => {
  it('measures growth within the cell, not from the run baseline', async () => {
    // Two cells on one observer: the second must not inherit the first's
    // growth, or a cell's memory and CPU figures double-count earlier cells.
    const samples = [
      { ...healthySample, apiAnonBytes: 300 * 1024 * 1024, apiCpuUsec: 0 },
      {
        ...healthySample,
        apiAnonBytes: 350 * 1024 * 1024,
        apiCpuUsec: 1_000_000,
      },
      {
        ...healthySample,
        apiAnonBytes: 400 * 1024 * 1024,
        apiCpuUsec: 5_000_000,
      },
      {
        ...healthySample,
        apiAnonBytes: 450 * 1024 * 1024,
        apiCpuUsec: 7_000_000,
      },
      {
        ...healthySample,
        apiAnonBytes: 500 * 1024 * 1024,
        apiCpuUsec: 9_000_000,
      },
    ]
    const result = await runLoad({
      cells: [
        { fixture, concurrency: 1, requests: 4, durationMs: 5000 },
        { fixture, concurrency: 1, requests: 4, durationMs: 5000 },
      ],
      transport: makeTransport({ uploadMs: 6 }),
      observer: makeObserver(samples),
      bounds: { ...quietBounds, sampleIntervalMs: 2, idleMs: 2, recoveryMs: 2 },
    })

    expect(result.perCell).toHaveLength(2)
    const [first, second] = result.perCell
    // A cell's baseline is its own first sample, not the run's: otherwise the
    // second cell would report the whole run's growth as its own.
    expect(first.resources.apiAnonBaselineBytes).not.toBe(
      result.baselineResources.apiAnonBytes,
    )
    expect(second.resources.apiAnonBaselineBytes).toBeGreaterThanOrEqual(
      first.resources.apiAnonBaselineBytes,
    )
    for (const cell of result.perCell)
      expect(cell.resources.apiAnonGrowthBytes).toBeLessThanOrEqual(
        cell.resources.apiAnonPeakBytes,
      )
  })
})
