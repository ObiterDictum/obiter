import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diffParity, runParityCheck } from './check-search-parity'

describe('diffParity', () => {
  it('reports clean when both sides agree', () => {
    expect(diffParity(['a', 'b'], ['a', 'b'])).toEqual({
      missingFromIndex: [],
      extraInIndex: [],
    })
  })

  it('detects a missing and an extra id in opposite directions', () => {
    expect(diffParity(['a', 'b'], ['b', 'c'])).toEqual({
      missingFromIndex: ['a'],
      extraInIndex: ['c'],
    })
  })
})

describe('runParityCheck', () => {
  it('detects deliberate drift seeded on both sides', async () => {
    const pool = {
      query: async () => ({
        rows: [{ document_id: 'a' }, { document_id: 'b' }],
      }),
    } as unknown as Parameters<typeof runParityCheck>[0]['pool']

    const report = await runParityCheck({
      pool,
      listIndexIds: async () => ['b', 'c'],
      indexName: 'legal_authorities',
      pageSize: 10,
    })

    expect(report.postgresCount).toBe(2)
    expect(report.indexCount).toBe(2)
    expect(report.missingFromIndex).toEqual(['a'])
    expect(report.extraInIndex).toEqual(['c'])
  })

  it('pages Postgres and scopes the record query to non-withdrawn rows', async () => {
    const seen: string[] = []
    const pool = {
      query: async (text: string) => {
        seen.push(text)
        return { rows: [] }
      },
    } as unknown as Parameters<typeof runParityCheck>[0]['pool']

    const report = await runParityCheck({
      pool,
      listIndexIds: async () => [],
      indexName: 'legal_authorities',
    })

    expect(seen[0]).toContain(`provider_json->>'withdrawn' is null`)
    expect(report.missingFromIndex).toEqual([])
    expect(report.extraInIndex).toEqual([])
  })
})

describe('search parity command', () => {
  it('exits non-zero when the index differs from Postgres', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'obiter-parity-'))
    try {
      const preload = join(directory, 'preload.ts')
      await writeFile(
        preload,
        `import { mock } from 'bun:test'
mock.module('pg', () => ({ Pool: class {
  async query() { return { rows: [{ document_id: 'missing' }] } }
  async end() {}
} }))
mock.module('@obiter/search-client', () => ({
  createClient: () => ({}),
  listDocumentIds: async () => [],
}))
`,
      )
      const child = Bun.spawn(
        [
          process.execPath,
          '--preload',
          preload,
          join(import.meta.dir, 'check-search-parity.ts'),
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      )

      expect(await child.exited).toBe(1)
      expect(await new Response(child.stdout).text()).toContain('"missing"')
      expect(await new Response(child.stderr).text()).toContain(
        'Search parity drift',
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
