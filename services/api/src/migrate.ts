import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

export interface MigrationResult {
  applied: string[]
  skipped: string[]
}

/** Plain SQL migrations, numbered and forward-only. Applied in filename order. */
export function resolveMigrationsDir() {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'packages',
    'database',
    'migrations',
  )
}

export function listMigrationFiles(migrationsDir: string) {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
}

/**
 * Applies pending migrations in filename order, tracking each in
 * schema_migrations. Idempotent: already-recorded files are skipped, so a
 * second run is a no-op. Each migration runs in its own transaction with its
 * tracking insert; the first failure rolls that file back, records nothing,
 * and throws naming the file — earlier files stay applied, later ones
 * untouched.
 */
export async function runMigrations(
  pool: Pool,
  migrationsDir: string = resolveMigrationsDir(),
): Promise<MigrationResult> {
  const client = await pool.connect()
  try {
    await client.query(
      `create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )`,
    )
    // Serialises concurrent appliers (rolling deploys, CLI vs server): the
    // second holder waits here instead of racing the first halfway through
    // the file list. Session-level, so it must live on this same client.
    await client.query(`select pg_advisory_lock(hashtext('obiter_migrations'))`)
    try {
      const files = listMigrationFiles(migrationsDir)
      const recorded = await client.query<{ filename: string }>(
        `select filename from schema_migrations`,
      )
      const done = new Set(recorded.rows.map((row) => row.filename))
      const result: MigrationResult = { applied: [], skipped: [] }
      for (const file of files) {
        if (done.has(file)) {
          result.skipped.push(file)
          continue
        }
        const sql = readFileSync(join(migrationsDir, file), 'utf8')
        await client.query('begin')
        try {
          await client.query(sql)
          await client.query(
            `insert into schema_migrations (filename) values ($1)`,
            [file],
          )
          await client.query('commit')
        } catch (error) {
          await client.query('rollback')
          const reason = error instanceof Error ? error.message : String(error)
          throw new Error(
            `Migration ${file} failed and was rolled back; no later migrations were applied: ${reason}`,
          )
        }
        result.applied.push(file)
      }
      return result
    } finally {
      await client.query(
        `select pg_advisory_unlock(hashtext('obiter_migrations'))`,
      )
    }
  } finally {
    client.release()
  }
}

function readExplicitDatabaseUrl() {
  const flag = process.argv
    .find((arg) => arg.startsWith('--database-url='))
    ?.slice('--database-url='.length)
  const url = flag ?? process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'Missing database URL: pass --database-url=<url> or set DATABASE_URL. ' +
        'The runner takes no default so the wrong database is never migrated by accident.',
    )
  }
  return url
}

async function main() {
  const databaseUrl = readExplicitDatabaseUrl()
  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const { applied, skipped } = await runMigrations(pool)
    if (applied.length === 0) {
      console.info(`No pending migrations (${skipped.length} already applied).`)
    } else {
      console.info(
        `Applied ${applied.length} migration(s): ${applied.join(', ')}`,
      )
    }
  } finally {
    await pool.end()
  }
}

if (process.argv[1]?.endsWith('migrate.ts'))
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Migration failed')
    process.exitCode = 1
  })
