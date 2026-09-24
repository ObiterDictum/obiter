import { describe, expect, it } from 'bun:test'
import {
  UPLOAD_FAILURE_CATEGORIES,
  classifyUploadResult,
  countByCategory,
  duplicates,
  percentile,
  summarise,
  throughputPerSecond,
} from './metrics.mjs'

function upload(overrides = {}) {
  return {
    category: 'ok',
    latencyMs: 100,
    ...overrides,
  }
}

describe('percentile', () => {
  it('returns null for an empty sample set rather than zero or NaN', () => {
    expect(percentile([], 0.95)).toBeNull()
    expect(summarise([])).toEqual({
      count: 0,
      min: null,
      max: null,
      mean: null,
      p50: null,
      p95: null,
    })
  })

  it('uses nearest-rank, so a percentile is always an observed sample', () => {
    const sorted = Array.from({ length: 20 }, (_, index) => index + 1)
    expect(percentile(sorted, 0.5)).toBe(10)
    expect(percentile(sorted, 0.95)).toBe(19)
    expect(percentile(sorted, 1)).toBe(20)
  })

  it('reports the single sample for every percentile of a one-sample set', () => {
    expect(percentile([7], 0.5)).toBe(7)
    expect(percentile([7], 0.95)).toBe(7)
  })

  it('summarises with a sample count alongside every figure', () => {
    const summary = summarise([300, 100, 200])
    expect(summary.count).toBe(3)
    expect(summary.p50).toBe(200)
    expect(summary.p95).toBe(300)
    expect(summary.mean).toBe(200)
  })
})

describe('classifyUploadResult', () => {
  const readyBody = {
    document: { id: 'doc_1' },
    version: {
      id: 'ver_1',
      documentStatus: 'ready',
      textObjectKey: 'org/x/text',
    },
  }

  it('accepts a 201 whose version is already ready', () => {
    expect(
      classifyUploadResult({
        outcome: 'response',
        status: 201,
        body: readyBody,
      }),
    ).toEqual({
      ok: true,
      category: 'ok',
      detail: null,
    })
  })

  it('does not count a 201 with a failed version as success', () => {
    const result = classifyUploadResult({
      outcome: 'response',
      status: 201,
      body: {
        document: { id: 'doc_1' },
        version: {
          id: 'ver_1',
          documentStatus: 'failed',
          failureReason: 'Document text could not be read.',
        },
      },
    })
    expect(result.ok).toBe(false)
    expect(result.category).toBe('extraction_failed')
  })

  it('fails a 201 whose version is not ready, because extraction is expected inline', () => {
    const result = classifyUploadResult({
      outcome: 'response',
      status: 201,
      body: {
        document: { id: 'doc_1' },
        version: { id: 'ver_1', documentStatus: 'queued' },
      },
    })
    expect(result.category).toBe('not_ready')
  })

  it('fails a 201 with no document or version id', () => {
    expect(
      classifyUploadResult({ outcome: 'response', status: 201, body: {} })
        .category,
    ).toBe('unexpected_body')
  })

  it.each([
    [400, 'validation_rejected'],
    [401, 'unauthenticated'],
    [403, 'forbidden'],
    [404, 'matter_not_found'],
    [413, 'package_limits'],
    [500, 'server_error'],
    [503, 'server_error'],
    [418, 'unexpected_status'],
  ])('classifies HTTP %i as %s', (status, category) => {
    expect(
      classifyUploadResult({ outcome: 'response', status, body: null })
        .category,
    ).toBe(category)
  })

  it('distinguishes a timeout from a transport failure', () => {
    expect(
      classifyUploadResult({ outcome: 'error', errorName: 'TimeoutError' })
        .category,
    ).toBe('timeout')
    expect(
      classifyUploadResult({
        outcome: 'error',
        errorName: 'TypeError',
        errorMessage: 'fetch failed',
      }).category,
    ).toBe('network_error')
  })
})

describe('attempt accounting', () => {
  it('counts every category, including the zeros a table needs', () => {
    const counts = countByCategory([
      upload(),
      upload({ category: 'server_error' }),
      upload({ category: 'cancelled' }),
    ])
    expect(counts.ok).toBe(1)
    expect(counts.server_error).toBe(1)
    expect(counts.cancelled).toBe(1)
    for (const category of UPLOAD_FAILURE_CATEGORIES)
      expect(counts[category]).toBeGreaterThanOrEqual(0)
  })

  it('refuses throughput for a zero-length window', () => {
    expect(throughputPerSecond(5, 0)).toBeNull()
    expect(throughputPerSecond(5, -1)).toBeNull()
    expect(throughputPerSecond(5, 1000)).toBe(5)
  })

  it('reports repeated values for the duplicate-record check', () => {
    expect(duplicates(['a', 'b', 'a', 'c', 'b', 'a'])).toEqual(['a', 'b'])
    expect(duplicates(['a', 'b'])).toEqual([])
  })
})
