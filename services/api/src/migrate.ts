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
 * Transaction control a migration must not carry. Postgres has no nested
 * transactions: a `begin` inside the runner's transaction is a no-op, but a
 * `commit` ends the runner's transaction early, so the file's statements
 * commit before its `schema_migrations` row does. The runner's promise — one
 * transaction per file, covering the tracking insert — then no longer holds,
 * and a later failure cannot roll the file back.
 *
 * Bare `end` is deliberately absent: `CASE … end` closes an expression, so only
 * `end work`/`end transaction` is unambiguous. `begin atomic` is a SQL-standard
 * function body, not a transaction block. The scanner emits a newline after
 * every terminator, so a statement is caught wherever it starts, not only at
 * the start of a line in the source.
 */
const TRANSACTION_CONTROL =
  /^\s*(?:begin(?!\s+atomic\b)|commit|rollback|abort|start\s+transaction|end\s+(?:work|transaction))\b/imu

/** Characters Postgres allows inside an identifier, `$` and non-ASCII included. */
function isIdentifierCharacter(character: string) {
  return character === '$' || isDollarTagCharacter(character)
}

/**
 * Characters a dollar-quote tag may contain. Postgres tags are identifiers, so
 * non-ASCII letters count; `$` itself delimits rather than continues one.
 */
function isDollarTagCharacter(character: string) {
  return /[A-Za-z0-9_]/.test(character) || character.charCodeAt(0) >= 0x80
}

/**
 * Skips a quoted run from its opening quote and returns the index after it. A
 * doubled quote is an escaped quote, except where backslash escapes apply
 * (`E'…'`), which consume the next character whatever it is.
 */
function skipQuoted(
  sql: string,
  start: number,
  quote: string,
  backslashEscapes: boolean,
) {
  let index = start + 1
  while (index < sql.length) {
    if (backslashEscapes && sql[index] === '\\') {
      index += 2
      continue
    }
    if (sql[index] !== quote) {
      index += 1
      continue
    }
    if (sql[index + 1] === quote) {
      index += 2
      continue
    }
    return index + 1
  }
  return sql.length
}

/**
 * Strips comments, quoted strings and dollar-quoted regions — none of which are
 * statements — in one left-to-right pass. Each construct is skipped where it
 * starts, so a `$$` or `'` inside another construct cannot swallow a real
 * statement (a `$$` in a comment must not hide a following `commit;`). A
 * `do $$ … begin … end; $$` body and a `CASE … end` are the reasons the scan is
 * needed at all: migrations legitimately contain both.
 *
 * `inIdentifier` carries the one piece of state a look-back cannot: an
 * identifier may contain `$` and non-ASCII, so `a$b$`, `a$$b$$` and `café$$`
 * are identifiers while `$$` after `(`, whitespace or a terminator opens a
 * dollar quote. The same state recognises the `E` of `E'…'`, so `else'b\'` is a
 * plain string.
 *
 * A statement terminator is followed by a newline, so a statement sharing its
 * line with another starts at the beginning of one.
 */
function withoutQuotedOrComments(sql: string) {
  let bare = ''
  let index = 0
  let inIdentifier = false
  let escapeIntroducer = false
  while (index < sql.length) {
    const character = sql[index]
    if (character === '-' && sql[index + 1] === '-') {
      const newline = sql.indexOf('\n', index)
      index = newline === -1 ? sql.length : newline
      bare += '\n'
      inIdentifier = false
      escapeIntroducer = false
      continue
    }
    if (character === '/' && sql[index + 1] === '*') {
      // Postgres nests block comments, so the matching `*/` closes the
      // outermost one.
      let depth = 1
      index += 2
      while (index < sql.length && depth > 0) {
        if (sql[index] === '/' && sql[index + 1] === '*') {
          depth += 1
          index += 2
          continue
        }
        if (sql[index] === '*' && sql[index + 1] === '/') {
          depth -= 1
          index += 2
          continue
        }
        index += 1
      }
      inIdentifier = false
      escapeIntroducer = false
      continue
    }
    if (character === '"') {
      index = skipQuoted(sql, index, '"', false)
      inIdentifier = false
      escapeIntroducer = false
      continue
    }
    if (character === "'") {
      index = skipQuoted(sql, index, "'", escapeIntroducer)
      inIdentifier = false
      escapeIntroducer = false
      continue
    }
    if (character === '$' && !inIdentifier) {
      let tagEnd = index + 1
      while (tagEnd < sql.length && isDollarTagCharacter(sql[tagEnd])) {
        tagEnd += 1
      }
      if (sql[tagEnd] === '$') {
        const tag = sql.slice(index, tagEnd + 1)
        const end = sql.indexOf(tag, tagEnd + 1)
        index = end === -1 ? sql.length : end + tag.length
        inIdentifier = false
        escapeIntroducer = false
        continue
      }
    }
    if (character === ';') {
      bare += ';\n'
      index += 1
      inIdentifier = false
      escapeIntroducer = false
      continue
    }
    // The `E` only introduces an escape string where an identifier does not
    // already contain it.
    escapeIntroducer = !inIdentifier && (character === 'e' || character === 'E')
    inIdentifier = isIdentifierCharacter(character)
    bare += character
    index += 1
  }
  return bare
}

/**
 * Refuses a migration that carries its own transaction control, naming the
 * statement so the author removes it rather than discovering a half-applied
 * file later.
 */
export function assertNoTransactionControl(filename: string, sql: string) {
  const match = TRANSACTION_CONTROL.exec(withoutQuotedOrComments(sql))
  if (match) {
    throw new Error(
      `Migration ${filename} carries transaction control (${match[0].trim()}). ` +
        'The runner already wraps each file in a transaction with its tracking insert; ' +
        'remove the statement so a failure rolls the whole file back.',
    )
  }
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
      // Validate every pending file before applying any: transaction control is
      // a static problem, and discovering it halfway down the list would leave
      // the database advanced by the files before it.
      for (const file of files) {
        if (done.has(file)) continue
        assertNoTransactionControl(
          file,
          readFileSync(join(migrationsDir, file), 'utf8'),
        )
      }
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
  // Name the target before touching anything: a stale DATABASE_URL is the
  // likeliest way to migrate the wrong database. Host and name only.
  const target = new URL(databaseUrl)
  console.info(
    `Migrating database ${target.pathname.replace(/^\//, '')} on host ${target.host}...`,
  )
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
