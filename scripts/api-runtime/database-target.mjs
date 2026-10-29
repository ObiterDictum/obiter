export class FixtureRefusal extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'FixtureRefusal'
    this.code = code
  }
}

const OWNED_DATABASES = [
  /^obiter_test$/,
  /^obiter_api_runtime(_test)?$/,
  /^obiter_api_ingress(_test)?$/,
  /^obiter_lane_[a-z0-9_]+_test$/,
]

const PROTECTED_DATABASES = new Set([
  'obiter',
  'obiter_corpus',
  'postgres',
  'template0',
  'template1',
])

const DATABASE_NAME_PATTERN = /^[A-Za-z0-9_]+$/

const DEFAULT_PORT = '5432'

function isProtectedDatabase(name) {
  return (
    PROTECTED_DATABASES.has(name) ||
    (name.startsWith('obiter_lane_') && !name.endsWith('_test'))
  )
}

function decodeComponent(value, code, label) {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new FixtureRefusal(
      code,
      `Refusing a DATABASE_URL whose ${label} is not valid percent-encoding.`,
    )
  }
}

export function resolveDatabaseTarget({ databaseUrl, allowDatabase = null }) {
  if (typeof databaseUrl !== 'string' || databaseUrl.trim() === '') {
    throw new FixtureRefusal(
      'database_url_missing',
      '--database-url is required; the harness will not fall back to a lane .env or a default database.',
    )
  }
  let parsed
  try {
    parsed = new URL(databaseUrl)
  } catch {
    throw new FixtureRefusal(
      'database_url_unparseable',
      '--database-url is not a URL, so the target database cannot be named.',
    )
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new FixtureRefusal(
      'database_url_protocol',
      `Refusing a ${parsed.protocol} URL: the API connects with a postgres:// URL.`,
    )
  }
  const queryKey = parsed.searchParams.keys().next().value
  if (queryKey !== undefined) {
    throw new FixtureRefusal(
      'database_url_query_override',
      `Refusing "${queryKey}" in the DATABASE_URL query: a query parameter reaches pg and psql differently, so one consumer could connect somewhere the other does not. Name the target in the authority and path instead.`,
    )
  }
  const host = parsed.hostname
  if (host.startsWith('[') || host.endsWith(']')) {
    throw new FixtureRefusal(
      'database_not_loopback',
      `Refusing ${host}: an IPv6 literal is bracketed in URL syntax, but neither the pg driver nor psql dials the bracketed form, so this harness refuses it rather than accept a target it cannot reach.`,
    )
  }
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new FixtureRefusal(
      'database_not_loopback',
      host === ''
        ? 'Refusing a DATABASE_URL with no host: fixtures and migrations are only written to a loopback database this task owns.'
        : `Refusing ${host}: fixtures and migrations are only written to a loopback database this task owns.`,
    )
  }
  const port = parsed.port || DEFAULT_PORT
  const rawName = parsed.pathname.replace(/^\//, '')
  if (rawName === '') {
    throw new FixtureRefusal(
      'database_name_missing',
      'Refusing a DATABASE_URL that names no database.',
    )
  }
  const name = decodeComponent(
    rawName,
    'database_name_encoded',
    'database name',
  )
  if (name !== rawName) {
    throw new FixtureRefusal(
      'database_name_encoded',
      'Refusing a percent-encoded database name: psql reads it literally while the API decodes it, so the two could connect to different databases.',
    )
  }
  if (!DATABASE_NAME_PATTERN.test(name)) {
    throw new FixtureRefusal(
      'database_name_invalid',
      `Refusing database name "${name}": it contains characters this harness does not target.`,
    )
  }
  const user = decodeComponent(parsed.username, 'database_user_invalid', 'user')
  if (user === '') {
    throw new FixtureRefusal(
      'database_user_missing',
      'Refusing a DATABASE_URL with no user: pg falls back to PGUSER and then the OS user, which is not identity this guard validated. Name the user in the URL.',
    )
  }
  const password = decodeComponent(
    parsed.password,
    'database_password_invalid',
    'password',
  )
  if (password === '') {
    throw new FixtureRefusal(
      'database_password_missing',
      'Refusing a DATABASE_URL with no password: pg would fall back to PGPASSWORD while psql could additionally read PGPASSFILE or ~/.pgpass, so the two could authenticate differently. Name the password in the URL.',
    )
  }
  if (isProtectedDatabase(name)) {
    throw new FixtureRefusal(
      'database_protected',
      `Refusing "${name}": it is a shared, cluster or lane development database, not a test target. ` +
        'The API applies migrations to whatever DATABASE_URL names at boot, and --allow-database cannot override this.',
    )
  }
  if (allowDatabase) {
    if (
      typeof allowDatabase !== 'string' ||
      !DATABASE_NAME_PATTERN.test(allowDatabase)
    ) {
      throw new FixtureRefusal(
        'allow_database_invalid',
        '--allow-database must be a plain database name.',
      )
    }
    if (allowDatabase !== name) {
      throw new FixtureRefusal(
        'database_not_owned',
        `Refusing to target "${name}": --allow-database names "${allowDatabase}", and the override can only confirm the URL's own database.`,
      )
    }
  } else if (!OWNED_DATABASES.some((pattern) => pattern.test(name))) {
    throw new FixtureRefusal(
      'database_not_owned',
      `Refusing to target "${name}". This harness owns only ` +
        'obiter_test, obiter_api_runtime, obiter_api_ingress and obiter_lane_<name>_test databases. ' +
        `Pass --allow-database=${name} only if that is deliberate.`,
    )
  }
  const url =
    `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}` +
    `@${host}:${port}/${name}`
  return { name, host, port, database: name, user, password, url }
}
