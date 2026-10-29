export interface DatabaseIdentity {
  host: string
  database: string
}

const defaultPostgresPort = '5432'
const postgresSchemes = new Set(['postgres:', 'postgresql:'])

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
