import { Pool } from 'pg'
import { afterEach, describe, expect, it } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import { createDatabasePools } from './database-pools'
import { createTestApiEnv } from './test-api-env'
import type { ApiEnv } from './env'

afterEach(() => {
  vi.restoreAllMocks()
})

const separateCorpusUrl =
  'postgres://obiter_corpus_reader@localhost:5432/obiter_corpus'
const corpusWriterUrl =
  'postgres://obiter_corpus_writer@localhost:5432/obiter_corpus'

function envWithCorpus(
  corpusDatabaseUrl: string,
  corpusWriteDatabaseUrl: string | null = null,
): ApiEnv {
  return createTestApiEnv({ corpusDatabaseUrl, corpusWriteDatabaseUrl })
}

describe('createDatabasePools mode selection', () => {
  it('shares one writable pool when no corpus target is configured', async () => {
    const pools = createDatabasePools(createTestApiEnv())

    expect(pools.corpus.read).toBe(pools.application)
    expect(pools.corpus.write).toBe(pools.application)

    await pools.close()
  })

  it.each([
    ['the identical URL', 'postgres://obiter:obiter@localhost:5432/obiter'],
    ['a host alias', 'postgres://obiter:obiter@127.0.0.1:5432/obiter'],
    ['an omitted default port', 'postgres://obiter:obiter@localhost/obiter'],
    [
      'a different role on the same database',
      'postgres://obiter_corpus_reader@localhost:5432/obiter',
    ],
    ['a genuinely separate database', separateCorpusUrl],
  ])(
    'marks %s as a separate read-only corpus and disables writes',
    async (_label, corpusDatabaseUrl) => {
      const pools = createDatabasePools(envWithCorpus(corpusDatabaseUrl))

      expect(pools.corpus.read).not.toBe(pools.application)
      expect(pools.corpus.write).toBeNull()

      await pools.close()
    },
  )

  it('wires a dedicated corpus writer when one is configured', async () => {
    const pools = createDatabasePools(
      envWithCorpus(separateCorpusUrl, corpusWriterUrl),
    )

    expect(pools.corpus.read).not.toBe(pools.application)
    expect(pools.corpus.write).not.toBe(pools.application)
    expect(pools.corpus.write).not.toBe(pools.corpus.read)

    await pools.close()
  })

  it('keeps reader and writer as distinct pools when their URLs are identical', async () => {
    const pools = createDatabasePools(
      envWithCorpus(separateCorpusUrl, separateCorpusUrl),
    )

    expect(pools.corpus.read).not.toBe(pools.corpus.write)
    expect(pools.corpus.read).not.toBe(pools.application)

    await pools.close()
  })

  it('refuses a writer with no reader even when called with a hand-built env', () => {
    expect(() =>
      createDatabasePools(
        createTestApiEnv({
          corpusDatabaseUrl: null,
          corpusWriteDatabaseUrl: corpusWriterUrl,
        }),
      ),
    ).toThrow(
      'CORPUS_WRITE_DATABASE_URL requires CORPUS_DATABASE_URL, or the process would read and write different databases.',
    )
  })
})

describe('createDatabasePools shutdown', () => {
  it('closes the single pool once when colocated', async () => {
    const end = vi.spyOn(Pool.prototype, 'end')
    const pools = createDatabasePools(createTestApiEnv())

    await pools.close()
    await pools.close()

    expect(end).toHaveBeenCalledTimes(1)
  })

  it('closes each distinct pool exactly once', async () => {
    const end = vi.spyOn(Pool.prototype, 'end')
    const pools = createDatabasePools(envWithCorpus(separateCorpusUrl))

    await pools.close()
    await pools.close()

    expect(end).toHaveBeenCalledTimes(2)
  })

  it('closes the application, reader and writer pools exactly once each', async () => {
    const end = vi.spyOn(Pool.prototype, 'end')
    const pools = createDatabasePools(
      envWithCorpus(separateCorpusUrl, corpusWriterUrl),
    )

    await pools.close()
    await pools.close()

    expect(end).toHaveBeenCalledTimes(3)
  })

  it('attempts the corpus close when the application close fails', async () => {
    const pools = createDatabasePools(envWithCorpus(separateCorpusUrl))
    const end = vi.spyOn(Pool.prototype, 'end').mockImplementation(function (
      this: Pool,
    ) {
      return this === pools.application
        ? Promise.reject(new Error('application end failed'))
        : Promise.resolve()
    })

    await expect(pools.close()).rejects.toThrow('application end failed')
    expect(end).toHaveBeenCalledTimes(2)
  })

  it('reports a corpus close failure', async () => {
    const pools = createDatabasePools(envWithCorpus(separateCorpusUrl))
    const end = vi.spyOn(Pool.prototype, 'end').mockImplementation(function (
      this: Pool,
    ) {
      return this === pools.application
        ? Promise.resolve()
        : Promise.reject(new Error('corpus end failed'))
    })

    await expect(pools.close()).rejects.toThrow('corpus end failed')
    expect(end).toHaveBeenCalledTimes(2)
  })

  it('reports both failures instead of discarding one', async () => {
    const pools = createDatabasePools(envWithCorpus(separateCorpusUrl))
    const end = vi
      .spyOn(Pool.prototype, 'end')
      .mockImplementation(() => Promise.reject(new Error('pool end failed')))

    const rejection = await pools.close().then(
      () => null,
      (error: unknown) => error,
    )

    expect(rejection).toBeInstanceOf(AggregateError)
    expect((rejection as AggregateError).errors).toHaveLength(2)
    expect(end).toHaveBeenCalledTimes(2)
  })

  it('reports every failure when all three pools fail to close', async () => {
    const pools = createDatabasePools(
      envWithCorpus(separateCorpusUrl, corpusWriterUrl),
    )
    const end = vi
      .spyOn(Pool.prototype, 'end')
      .mockImplementation(() => Promise.reject(new Error('pool end failed')))

    const rejection = await pools.close().then(
      () => null,
      (error: unknown) => error,
    )

    expect(rejection).toBeInstanceOf(AggregateError)
    expect((rejection as AggregateError).errors).toHaveLength(3)
    expect(end).toHaveBeenCalledTimes(3)
  })

  it('does not close a pool again after a failed close', async () => {
    const pools = createDatabasePools(envWithCorpus(separateCorpusUrl))
    const end = vi
      .spyOn(Pool.prototype, 'end')
      .mockImplementation(() => Promise.reject(new Error('pool end failed')))

    await expect(pools.close()).rejects.toBeInstanceOf(AggregateError)
    await expect(pools.close()).rejects.toBeInstanceOf(AggregateError)

    expect(end).toHaveBeenCalledTimes(2)
  })

  it('shares one attempt between concurrent closes', async () => {
    const pools = createDatabasePools(envWithCorpus(separateCorpusUrl))
    const end = vi.spyOn(Pool.prototype, 'end')

    const results = await Promise.allSettled([pools.close(), pools.close()])

    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
    ])
    expect(end).toHaveBeenCalledTimes(2)
  })
})
