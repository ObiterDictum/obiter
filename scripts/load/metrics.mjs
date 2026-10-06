/*
 * Sample aggregation and upload-outcome classification for the load harness.
 *
 * Pure by construction: no clock, no network, no filesystem. The accounting
 * rules that decide "was this request a success" are the part of a load test
 * that silently lies, so they are unit-tested directly rather than inferred
 * from a real run.
 */

/**
 * Nearest-rank percentile over an ascending-sorted array.
 *
 * Returns `null` for an empty sample set. A p95 of zero samples is not
 * "0 ms": it is "no data", and an arithmetic result here would be read as a
 * measured fast path.
 */
export function percentile(sortedAscending, fraction) {
  const count = sortedAscending.length
  if (count === 0) return null
  const rank = Math.ceil(fraction * count)
  const index = Math.min(Math.max(rank, 1), count) - 1
  return sortedAscending[index]
}

/** `null` rather than `NaN`/`0` for every statistic of an empty set (P14). */
export function summarise(values) {
  if (values.length === 0)
    return { count: 0, min: null, max: null, mean: null, p50: null, p95: null }

  const sorted = [...values].sort((left, right) => left - right)
  const total = sorted.reduce((sum, value) => sum + value, 0)
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: total / sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
  }
}

/**
 * Outcome categories. Every non-`ok` category is a failure: an upload that
 * was expected to be accepted and was not is a defect or a bound, never
 * throughput.
 */
export const UPLOAD_CATEGORIES = {
  ok: 'stored, extracted and reported ready in one request',
  extraction_failed:
    'accepted with 201 but the version landed failed — not a success',
  not_ready:
    'accepted with 201 but the version was not ready on return, so the extraction boundary moved',
  unexpected_body: 'a 201 whose body did not carry a document and version id',
  unexpected_status: 'a status this harness does not classify',
  cancelled: 'aborted by the run itself, so not a result',
  package_limits: 'rejected by the OOXML package limits',
  validation_rejected: 'rejected as invalid metadata or content',
  unauthenticated: 'rejected as unauthenticated',
  forbidden: 'rejected as unauthorised for this matter',
  matter_not_found: 'the target matter was not visible to this session',
  server_error: 'the API answered 5xx',
  network_error: 'no HTTP response was produced',
  timeout: 'the request exceeded the per-request bound',
}

export const UPLOAD_FAILURE_CATEGORIES = Object.keys(UPLOAD_CATEGORIES).filter(
  (category) => category !== 'ok' && category !== 'cancelled',
)

/**
 * Classify one completed upload attempt. `result` is the transport's raw
 * observation, never a pre-judged success flag, so the classification is the
 * single place that decides what counts.
 */
export function classifyUploadResult(result) {
  if (result.outcome === 'error') {
    const name = result.errorName ?? ''
    if (name === 'TimeoutError' || name === 'AbortError')
      return {
        ok: false,
        category: 'timeout',
        detail: result.errorMessage ?? 'request aborted',
      }
    return {
      ok: false,
      category: 'network_error',
      detail: result.errorMessage ?? 'request failed',
    }
  }

  const { status, body } = result
  if (status === 201) {
    const documentId = body?.document?.id
    const version = body?.version
    if (typeof documentId !== 'string' || typeof version?.id !== 'string')
      return {
        ok: false,
        category: 'unexpected_body',
        detail: '201 response carried no document or version id',
      }
    if (version.documentStatus === 'failed')
      return {
        ok: false,
        category: 'extraction_failed',
        detail: version.failureReason ?? 'extraction reported failed',
      }
    if (version.documentStatus !== 'ready')
      return {
        ok: false,
        category: 'not_ready',
        detail: `version status was ${String(version.documentStatus)}`,
      }
    return { ok: true, category: 'ok', detail: null }
  }

  const byStatus = {
    400: 'validation_rejected',
    401: 'unauthenticated',
    403: 'forbidden',
    404: 'matter_not_found',
    413: 'package_limits',
  }
  if (byStatus[status])
    return { ok: false, category: byStatus[status], detail: errorCode(body) }
  if (typeof status === 'number' && status >= 500)
    return { ok: false, category: 'server_error', detail: errorCode(body) }
  return {
    ok: false,
    category: 'unexpected_status',
    detail: `status ${String(status)}`,
  }
}

/** The API's own error code when present; the message is never retained. */
function errorCode(body) {
  const code = body?.error?.code
  return typeof code === 'string' ? code : null
}

/**
 * Classify one probe attempt. The probe has to answer 200: a redirect, an error
 * or a stall on the unrelated read is the finding this harness exists to
 * surface, so anything else fails the cell.
 */
export function classifyProbeResult(attempt, runSignal) {
  if (runSignal?.aborted)
    return { ok: false, category: 'cancelled', status: null }
  if (attempt.outcome === 'error')
    return {
      ok: false,
      category:
        attempt.errorName === 'TimeoutError' ||
        attempt.errorName === 'AbortError'
          ? 'timeout'
          : 'network_error',
      status: null,
    }
  return {
    ok: attempt.status === 200,
    category: attempt.status === 200 ? 'ok' : `http_${attempt.status}`,
    status: attempt.status,
  }
}

/** Counts by category, including zeros, so a table row is never missing. */
export function countByCategory(attempts) {
  const counts = { ok: 0, cancelled: 0 }
  for (const category of UPLOAD_FAILURE_CATEGORIES) counts[category] = 0
  for (const attempt of attempts) counts[attempt.category] += 1
  return counts
}

/**
 * Throughput in requests per second, or `null` when the cell observed no
 * wall-clock span. `Math.round` to 2dp keeps the JSON report stable.
 */
export function throughputPerSecond(count, observedMs) {
  if (!(observedMs > 0)) return null
  return Math.round((count / observedMs) * 1000 * 100) / 100
}

/** Values that occur more than once, for partial/duplicate record checks. */
export function duplicates(values) {
  const seen = new Set()
  const repeated = new Set()
  for (const value of values) {
    if (seen.has(value)) repeated.add(value)
    else seen.add(value)
  }
  return [...repeated].sort()
}
