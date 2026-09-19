/**
 * Parsed identity of a PostgreSQL connection string, and the one comparison of
 * two targets. Host and percent-decoded database name identify the database;
 * the port is normalised to 5432 when omitted. Credentials, parameters,
 * fragments and a trailing slash do not change the identity, so a target
 * written differently is recognised as the same database.
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

  return {
    host: `${parsed.hostname}:${parsed.port || defaultPostgresPort}`,
    database: decoded.replace(/\/+$/, ''),
  }
}

export function sameDatabaseIdentity(
  left: DatabaseIdentity,
  right: DatabaseIdentity,
): boolean {
  return left.host === right.host && left.database === right.database
}
