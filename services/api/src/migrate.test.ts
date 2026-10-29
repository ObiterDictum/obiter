import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import type { Pool, PoolClient } from 'pg'
import {
  assertNoTransactionControl,
  listMigrationFiles,
  resolveMigrationsDir,
  runMigrations,
} from './migrate'

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
      expect(statements[0]).toContain(
        'create table if not exists schema_migrations',
      )
      expect(statements[1]).toContain('pg_advisory_lock')
      expect(statements.at(-1)).toContain('pg_advisory_unlock')
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

  it('refuses transaction control in any pending file before applying any', async () => {
    const dir = fixtureDir({
      '0001_ok.sql': 'select 1',
      '0002_wrapped.sql': 'begin;\nselect 2;\ncommit;\n',
    })
    try {
      const { pool, statements } = createMockPool()
      await expect(runMigrations(pool, dir)).rejects.toThrow(
        'Migration 0002_wrapped.sql carries transaction control (begin)',
      )
      expect(statements.filter((s) => s === 'begin')).toHaveLength(0)
      expect(
        statements.some((s) => s.startsWith('insert into schema_migrations')),
      ).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('allows transaction words inside quoted strings and dollar-quoted bodies', async () => {
    const dir = fixtureDir({
      '0001_dollar.sql':
        'insert into notes (body) values ($tag$\ncommit;\n$tag$);\n',
      '0002_literal.sql':
        "insert into notes (body) values ('\nrollback;\n');\n",
      '0003_plpgsql.sql':
        'create function f() returns void as $$\nbegin\n  perform 1;\nend;\n$$ language plpgsql;\n',
    })
    try {
      const { pool } = createMockPool()
      await expect(runMigrations(pool, dir)).resolves.toEqual({
        applied: ['0001_dollar.sql', '0002_literal.sql', '0003_plpgsql.sql'],
        skipped: [],
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each([
    'abort;',
    'end work;',
    'end transaction;',
    'commit and chain;',
    'begin isolation level serializable;',
    'start transaction read write;',
  ])('refuses %s as transaction control', async (statement) => {
    const dir = fixtureDir({ '0001_wrapped.sql': `select 1;\n${statement}\n` })
    try {
      const { pool } = createMockPool()
      await expect(runMigrations(pool, dir)).rejects.toThrow(
        'carries transaction control',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('ships no migration carrying transaction control', () => {
    const dir = resolveMigrationsDir()
    const files = listMigrationFiles(dir)
    expect(files.length).toBeGreaterThan(0)
    const offenders = files.filter((file) => {
      try {
        assertNoTransactionControl(file, readFileSync(join(dir, file), 'utf8'))
        return false
      } catch {
        return true
      }
    })
    expect(offenders).toEqual([])
  })
})

describe('migration guard lexing', () => {
  it.each([
    ['a statement after $$ in a comment', '-- costs $$\ncommit;\n'],
    ['a statement after an escape string', "select E'it\\'s';\ncommit;\n"],
    ['a statement after a doubled quote', "select 'it''s';\ncommit;\n"],
    [
      'a statement after a $ inside an identifier',
      'create table a$b$ (x int);\ncommit;\n',
    ],
    [
      'a statement after a quoted identifier',
      'create table "o\'brien" (x int);\ncommit;\n',
    ],
    ['a statement sharing a line with another', 'select 1; commit;\n'],
    [
      'a statement after a nested block comment',
      "/* a /* b */ it's */\ncommit;\n",
    ],
    [
      'a statement after an identifier ending in $',
      'create table a$$b$$ (x int);\ncommit;\n',
    ],
    [
      'a statement after a non-ASCII identifier',
      'create table caf\u00e9$$ (x int);\ncommit;\n',
    ],
    [
      'a statement after a plain string containing a backslash',
      "select case when x then 'a' else'b\\' end;\ncommit;\n",
    ],
    [
      'a statement after a non-ASCII dollar-quote tag',
      "select $\u00e9$it's$\u00e9$;\ncommit;\n",
    ],
  ])('refuses %s', (_label, sql) => {
    expect(() => assertNoTransactionControl('0001_x.sql', sql)).toThrow(
      'carries transaction control',
    )
  })

  it.each([
    [
      'a CASE expression closing with end',
      'select case when true then 1\nend;\n',
    ],
    [
      'a transaction word inside a dollar-quoted body',
      'do $fn$\nbegin\n  commit;\nend\n$fn$;\n',
    ],
    ['a transaction word inside a plain string', "select 'commit;';\n"],
    ['a column named commit_sha', 'select commit_sha from runs;\n'],
    [
      'a SQL-standard function body',
      'create function f() returns int\nbegin atomic\n  select 1;\nend;\n',
    ],
  ])('allows %s', (_label, sql) => {
    expect(() => assertNoTransactionControl('0001_x.sql', sql)).not.toThrow()
  })
})
