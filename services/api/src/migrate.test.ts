import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import { listMigrationFiles, runMigrations } from './migrate'

function fixtureDir(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'obiter-migrate-test-'))
  for (const [name, sql] of Object.entries(files)) {
    writeFileSync(join(dir, name), sql)
  }
  return dir
}

interface MockPoolOptions {
  recorded?: string[]
  failOn?: (sql: string) => boolean
}

function createMockPool(options: MockPoolOptions = {}) {
  const statements: string[] = []
  const recorded = [...(options.recorded ?? [])]
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      statements.push(sql)
      if (options.failOn?.(sql)) throw new Error('boom')
      if (sql.startsWith('insert into schema_migrations')) {
        recorded.push(String(params?.[0]))
      }
      if (sql.startsWith('select filename from schema_migrations')) {
        return { rows: recorded.map((filename) => ({ filename })) }
      }
      return { rows: [] }
    },
    release: () => undefined,
  } as unknown as PoolClient
  const pool = { connect: async () => client } as unknown as Pool
  return { pool, statements }
}

describe('migration runner', () => {
  it('lists migration files in filename order', () => {
    const dir = fixtureDir({
      '0002_b.sql': 'select 1',
      '0001_a.sql': 'select 1',
      'notes.txt': 'ignored',
    })
    try {
      expect(listMigrationFiles(dir)).toEqual(['0001_a.sql', '0002_b.sql'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('applies pending migrations and skips recorded ones (idempotent)', async () => {
    const dir = fixtureDir({
      '0001_a.sql': 'select 1',
      '0002_b.sql': 'select 2',
    })
    try {
      const { pool, statements } = createMockPool({ recorded: ['0001_a.sql'] })
      const result = await runMigrations(pool, dir)
      expect(result).toEqual({
        applied: ['0002_b.sql'],
        skipped: ['0001_a.sql'],
      })
      // Tracking table created, advisory lock held around the whole run.
      expect(statements[0]).toContain(
        'create table if not exists schema_migrations',
      )
      expect(statements[1]).toContain('pg_advisory_lock')
      expect(statements.at(-1)).toContain('pg_advisory_unlock')
      // Second run against the now-recorded state is a no-op.
      const second = createMockPool({ recorded: ['0001_a.sql', '0002_b.sql'] })
      await expect(runMigrations(second.pool, dir)).resolves.toEqual({
        applied: [],
        skipped: ['0001_a.sql', '0002_b.sql'],
      })
      expect(second.statements.some((s) => s === 'begin')).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('stops at the first failure, names the file, leaves later files unapplied', async () => {
    const dir = fixtureDir({
      '0001_ok.sql': 'select 1',
      '0002_bad.sql': 'select 1',
      '0003_never.sql': 'select 1',
    })
    try {
      const { pool, statements } = createMockPool({
        failOn: (sql) =>
          sql === 'select 1' &&
          statements.filter((s) => s === 'select 1').length === 2,
      })
      await expect(runMigrations(pool, dir)).rejects.toThrow(
        'Migration 0002_bad.sql failed',
      )
      expect(statements).toContain('rollback')
      expect(statements.filter((s) => s === 'select 1')).toHaveLength(2)
      expect(statements.at(-1)).toContain('pg_advisory_unlock')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
