/*
 * The one database the API runtime harness may touch, resolved and proved
 * before any connection, migration, port allocation or child process.
 *
 * The API applies migrations to whatever `DATABASE_URL` names at boot, so a
 * guard that accepts a lane's development database does not merely write
 * fixtures to it: it migrates it. That is what happened to
 * `obiter_lane_security` before this module existed.
 *
 * A name is not proof a host is ours, and neither is a URL a connection: pg
 * and psql resolve the same URL differently. pg reads `PGPORT`/`PGUSER`/
 * `PGPASSWORD` from the environment when the URL omits them, while psql is
 * pinned to the port the harness sets, and a query parameter such as `host` or
 * `service` can move one consumer and not the other. So the guard resolves the
 * whole target once and returns every component explicitly: host, port,
 * database, user and password. Callers hand the canonical `url` to the API
 * child and psql alike, and the child environment pins the same values, so no
 * ambient `PG*` variable can move a connection the guard did not validate.
 */
export class FixtureRefusal extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'FixtureRefusal'
    this.code = code
  }
}

/**
 * Databases this harness may target without --allow-database. `obiter_test` is
 * the CI/local test database; `obiter_api_runtime`/`obiter_api_ingress` are
 * created by this repository's own harnesses; a lane counts only through its
 * test database. A lane's development database (`obiter_lane_security`) is
 * deliberately absent.
 */
const OWNED_DATABASES = [
  /^obiter_test$/,
  /^obiter_api_runtime(_test)?$/,
  /^obiter_api_ingress(_test)?$/,
  /^obiter_lane_[a-z0-9_]+_test$/,
]

/**
 * Databases that are never a harness target, whatever `--allow-database` says.
 * `obiter` and `obiter_corpus` are shared, and `postgres`/`template*` belong to
 * the cluster, so naming one is a migration of data this run does not own.
 */
const PROTECTED_DATABASES = new Set([
  'obiter',
  'obiter_corpus',
  'postgres',
  'template0',
  'template1',
])

// Names that psql reads as-is and node-postgres decodes identically. A name
// outside this set is either ambiguous between the two or not a name this
// harness uses.
const DATABASE_NAME_PATTERN = /^[A-Za-z0-9_]+$/

// pg's own default when the URL omits a port. Pinned here so a portless URL is
// serialized into a canonical one that names the port explicitly.
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

/**
 * Resolve the one database this run may touch, and refuse everything else.
 *
 * The returned target names `host`, `port`, `database`, `user` and `password`
 * explicitly, and `url` is a canonical URL carrying exactly those values. That
 * URL is the one handed to the launched API, the psql fixtures and the corpus
 * boots. Validating a copy of the argument while the child still receives the
 * raw string is the defect this function exists to prevent, so callers use
 * `target.url`, `target.host`, `target.port`, `target.database`, `target.user`
 * and `target.password` and nothing else.
 *
 * Refused: missing, unparseable or non-`postgres` URLs, any connection query
 * parameter, non-loopback or bracketed IPv6 hosts, missing/encoded/oddly-named
 * databases, missing user or password, shared/cluster/lane-development
 * databases (even with `--allow-database`), and any database outside this
 * harness's owned set.
 */
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
  // `--allow-database` is an explicit owner override, not proof of ownership:
  // an exact name match says "I meant this database", not "this database is
  // disposable". It admits a non-owned name, but never a protected one, and it
  // can only ever confirm the resolved name, so it cannot redirect the target.
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
