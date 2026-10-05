/*
 * The bounded load driver.
 *
 * One cell = one fixture size at one concurrency. Cells run in the order given
 * (1, then 2, then 4) and each is refused before it starts if the machine has no
 * headroom left, so escalation is gated on observation rather than assumption.
 * There is no ramp loop and no "until it breaks": the request count, the
 * concurrency and the wall clock are all fixed before the first request, and any
 * breached bound stops the run instead of extending it.
 *
 * The transport, the observer and the clock are injected. That is what lets the
 * accounting, the bounds and the cancellation be tested without a server, and it
 * keeps every timing decision in this file rather than in the HTTP layer.
 */
import { classifyProbeResult, classifyUploadResult } from './metrics.mjs'
import {
  aggregate,
  DEFAULT_BOUNDS,
  evaluateBounds,
  resourceBreach,
} from './bounds.mjs'
import { summariseCell } from './cell-summary.mjs'

/**
 * Run the cell list. Returns observations, never a verdict: the CLI owns the
 * exit code so exactly one place decides what a run's result means.
 */
export async function runLoad({
  cells,
  transport,
  observer,
  bounds = DEFAULT_BOUNDS,
  signal,
  now = () => Date.now(),
  delay = sleepFor,
  log = () => {},
}) {
  const uploads = []
  const probes = []
  const perCell = []
  const skipped = []
  let samplerErrors = 0
  let observationCount = 0

  const observe = async () => {
    if (!observer) return null
    try {
      const sample = await observer.sample()
      observationCount += 1
      return sample
    } catch {
      samplerErrors += 1
      return null
    }
  }

  const baselineResources = await observe()
  const growthAgainstBaseline = (resources) => {
    if (!resources || !baselineResources) return resources
    return {
      ...resources,
      apiAnonGrowthBytes:
        resources.apiAnonBytes != null && baselineResources.apiAnonBytes != null
          ? resources.apiAnonBytes - baselineResources.apiAnonBytes
          : null,
    }
  }

  log(`idle probe ${bounds.idleMs} ms`)
  await runProbePhase({
    phase: 'idle',
    cell: null,
    durationMs: bounds.idleMs,
    stopSignal: signal,
  })

  for (const [index, cell] of cells.entries()) {
    const gate = signal?.aborted
      ? { reason: 'cancelled' }
      : resourceBreach(growthAgainstBaseline(await observe()), bounds)
    if (gate) {
      skipped.push({
        concurrency: cell.concurrency,
        size: cell.fixture.size,
        reason: gate.reason,
      })
      log(`cell ${index} refused before start: ${gate.reason}`)
      continue
    }

    const result = await runCell(index, cell)
    perCell.push(result)
    log(
      `cell ${index}: ${cell.fixture.size} x${cell.concurrency} -> ${result.counts.ok} ok, ` +
        `${result.failures} failed${result.aborted ? `, aborted (${result.abortReason.reason})` : ''}`,
    )
    if (result.aborted) break
  }

  log(`recovery probe ${bounds.recoveryMs} ms`)
  const recoverySamples = []
  const recoverySampling = sampleWindow({
    durationMs: bounds.recoveryMs,
    sink: recoverySamples,
    stopSignal: signal,
  })
  await runProbePhase({
    phase: 'recovery',
    cell: null,
    durationMs: bounds.recoveryMs,
    stopSignal: signal,
  })
  await recoverySampling

  return {
    baselineResources,
    recoverySamples,
    samplerErrors,
    observationCount,
    perCell,
    skipped,
    uploads,
    probes,
    cancelled: signal?.aborted === true,
  }

  /**
   * Resource sampling for a bounded window. Used for both the load and the
   * recovery window so "during" and "after" are measured the same way.
   */
  async function sampleWindow({ durationMs, sink, stopSignal }) {
    if (!observer) return
    const endsAt = now() + durationMs
    while (now() < endsAt && !stopSignal?.aborted) {
      const sample = await observe()
      if (sample) sink.push(sample)
      const remaining = Math.min(bounds.sampleIntervalMs, endsAt - now())
      if (remaining > 0) await delay(remaining, stopSignal)
    }
  }

  /** One probe cadence; the loop is self-scheduling so probes never pile up. */
  async function runProbePhase({ phase, cell, durationMs, stopSignal }) {
    const endsAt = now() + durationMs
    while (now() < endsAt && !stopSignal?.aborted) {
      const started = now()
      const attempt = await safeCall(() =>
        transport.probe({
          signal: timeoutSignal(signal, bounds.probeTimeoutMs),
        }),
      )
      probes.push({
        phase,
        cellIndex: cell?.index ?? null,
        concurrency: cell?.concurrency ?? null,
        latencyMs: now() - started,
        ...classifyProbeResult(attempt, signal),
      })
      const remaining = Math.min(bounds.probeIntervalMs, endsAt - now())
      if (remaining > 0) await delay(remaining, stopSignal)
    }
  }

  async function runCell(index, cell) {
    const samples = []
    const cellController = new AbortController()
    const onRunAbort = () => {
      abortReason ??= { reason: 'cancelled', observed: null, bound: null }
      cellController.abort()
    }
    const abortReasonForRun = signal?.aborted
      ? { reason: 'cancelled', observed: null, bound: null }
      : null
    let abortReason = abortReasonForRun
    signal?.addEventListener('abort', onRunAbort, { once: true })

    const phaseController = new AbortController()
    const sampler = sampleWindow({
      durationMs: bounds.maxCellDurationMs,
      sink: samples,
      stopSignal: phaseController.signal,
    })

    const startedAt = now()
    let issued = 0
    let nextIndex = 0

    // The tick loop runs alongside the workers: a breach stops issuing new
    // requests while the in-flight ones are still allowed to answer.
    const tick = setInterval(() => {
      if (abortReason) return
      const breach = evaluateBounds(
        aggregate(
          attemptsFor(index),
          now() - startedAt,
          growthAgainstBaseline(samples.at(-1)),
        ),
        bounds,
      )
      if (breach) {
        abortReason = breach
        cellController.abort()
      }
    }, bounds.tickIntervalMs)

    const probeLoop = runProbePhase({
      phase: 'during',
      cell: { index, concurrency: cell.concurrency },
      durationMs: bounds.maxCellDurationMs,
      stopSignal: phaseController.signal,
    })

    const worker = async () => {
      while (!abortReason && !signal?.aborted) {
        const current = nextIndex
        nextIndex += 1
        if (current >= cell.requests) return
        if (now() - startedAt >= cell.durationMs) return

        issued += 1
        const started = now()
        const attempt = await safeCall(() =>
          transport.upload(cell.fixture, {
            signal: timeoutSignal(
              cellController.signal,
              bounds.requestTimeoutMs,
            ),
          }),
        )
        const latencyMs = now() - started
        const cancelled =
          cellController.signal.aborted || signal?.aborted === true
        const classified = cancelled
          ? { ok: false, category: 'cancelled', detail: null }
          : classifyUploadResult(attempt)
        uploads.push({
          cellIndex: index,
          concurrency: cell.concurrency,
          size: cell.fixture.size,
          bytes: cell.fixture.bytes,
          latencyMs,
          ...classified,
          status: attempt.outcome === 'response' ? attempt.status : null,
          atMs: started,
        })
      }
    }

    await Promise.all(Array.from({ length: cell.concurrency }, worker))
    clearInterval(tick)
    phaseController.abort()
    await probeLoop.catch(() => {})
    await sampler
    signal?.removeEventListener('abort', onRunAbort)

    const loadMs = now() - startedAt
    const cellUploads = attemptsFor(index)
    return summariseCell({
      cell,
      index,
      cellUploads,
      duringProbes: probes.filter(
        (entry) => entry.cellIndex === index && entry.phase === 'during',
      ),
      loadMs,
      samples,
      baselineResources,
      abortReason,
      issued,
    })
  }

  function attemptsFor(index) {
    return uploads.filter((entry) => entry.cellIndex === index)
  }
}

async function safeCall(call) {
  try {
    return await call()
  } catch (error) {
    return {
      outcome: 'error',
      errorName: error?.name ?? 'Error',
      errorMessage: error instanceof Error ? error.message : String(error),
    }
  }
}

/** An external abort and a per-request timeout both have to reach the transport. */
function timeoutSignal(outerSignal, timeoutMs) {
  const signals = [AbortSignal.timeout(timeoutMs)]
  if (outerSignal) signals.push(outerSignal)
  return AbortSignal.any(signals)
}

function sleepFor(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}
