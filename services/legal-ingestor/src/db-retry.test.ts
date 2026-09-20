import { describe, expect, it, vi } from 'vitest'
import { withConcurrencyRetry } from './db-retry'

function pgError(code: string) {
  const error = new Error(`simulated ${code}`) as Error & { code: string }
  error.code = code
  return error
}

describe('withConcurrencyRetry', () => {
  it('returns the first successful result without retrying', async () => {
    const operation = vi.fn(async () => 'written')

    await expect(withConcurrencyRetry(operation)).resolves.toBe('written')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it.each(['40001', '40P01'])(
    'retries %s until the operation succeeds',
    async (code) => {
      const operation = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce(pgError(code))
        .mockResolvedValueOnce('written')

      await expect(withConcurrencyRetry(operation)).resolves.toBe('written')
      expect(operation).toHaveBeenCalledTimes(2)
    },
  )

  it('does not retry a constraint violation', async () => {
    const operation = vi.fn(async () => {
      throw pgError('23505')
    })

    await expect(withConcurrencyRetry(operation)).rejects.toThrow(
      'simulated 23505',
    )
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('does not retry an error with no SQLSTATE', async () => {
    const operation = vi.fn(async () => {
      throw new Error('connection terminated')
    })

    await expect(withConcurrencyRetry(operation)).rejects.toThrow(
      'connection terminated',
    )
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('gives up after the attempt bound and names the SQLSTATE', async () => {
    const operation = vi.fn(async () => {
      throw pgError('40P01')
    })

    await expect(
      withConcurrencyRetry(operation, { attempts: 3 }),
    ).rejects.toThrow(/SQLSTATE 40P01 and were not retried further: 3 attempt/)
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('gives up at the elapsed bound before the attempt bound', async () => {
    // A zero ceiling makes the first failure the last: the point is that the
    // elapsed bound is consulted at all, without depending on wall-clock time.
    const operation = vi.fn(async () => {
      throw pgError('40001')
    })

    await expect(
      withConcurrencyRetry(operation, { attempts: 10, maxElapsedMs: 0 }),
    ).rejects.toThrow(/1 attempt/)
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('keeps the original error as the cause so the failure stays attributable', async () => {
    const operation = vi.fn(async () => {
      throw pgError('40001')
    })

    const failure = await withConcurrencyRetry(operation, {
      attempts: 1,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).cause).toBeInstanceOf(Error)
  })
})
