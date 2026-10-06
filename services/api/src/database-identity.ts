/**
 * Parsed identity of a PostgreSQL connection string, and the one comparison of
 * two targets. Only a `postgres:` or `postgresql:` URL that names exactly one
 * database is accepted, so a nameless or non-PostgreSQL target fails when the
 * configuration is read rather than at the first query. Host and
 * percent-decoded database name identify the database; the port is normalised
 * to 5432 when omitted. Credentials, parameters, fragments and a trailing
 * slash do not change the identity, so a target written differently is
 * recognised as the same database.
 *
 * Host aliases are deliberately not resolved: `localhost` and `127.0.0.1` can
 * name the same server, but proving it needs DNS, and guessing would be worse
 * than treating them as different targets.
 */
export interface DatabaseIdentity {
  host: string
  database: string
}

const defaultPostgresPort = '5432'
const postgresSchemes = new Set(['postgres:', 'postgresql:'])

/** A control character cannot appear in a database name a URI can address. */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

export function readDatabaseIdentity(
  connectionString: string,
  label: string,
): DatabaseIdentity {
  let parsed: URL
  try {
    parsed = new URL(connectionString)
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL.`)
  }

  if (!postgresSchemes.has(parsed.protocol)) {
    throw new Error(`${label} must use the postgres: or postgresql: scheme.`)
  }

  const path = parsed.pathname.replace(/^\//, '')
  if (path.length === 0) {
    throw new Error(`${label} must name a database.`)
  }

  let decoded: string
  try {
    decoded = decodeURIComponent(path)
  } catch {
    throw new Error(`${label} names a database with invalid percent-encoding.`)
  }

  // A trailing slash is decoration; anything else after decoding that still
  // contains a path separator names more than one segment, not one database,
  // and a control character cannot appear in a database name at all.
  const database = decoded.replace(/\/+$/, '')
  if (database.length === 0) {
    throw new Error(`${label} must name a database.`)
  }
  if (database.includes('/') || hasControlCharacter(database)) {
    throw new Error(`${label} must name exactly one database.`)
  }

  return {
    host: `${parsed.hostname}:${parsed.port || defaultPostgresPort}`,
    database,
  }
}

export function sameDatabaseIdentity(
  left: DatabaseIdentity,
  right: DatabaseIdentity,
): boolean {
  return left.host === right.host && left.database === right.database
}
