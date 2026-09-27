/*
 * The one database the API runtime harness may touch, resolved and proved
 * before any connection, migration, port allocation or child process.
 *
 * The API applies migrations to whatever `DATABASE_URL` names at boot, so a
 * guard that accepts a lane's development database does not merely write
 * fixtures to it: it migrates it. That is what happened to
 * `obiter_lane_security` before this module existed.
 *
 * A name is not proof a host is ours. The guard resolves the whole target the
 * way the launched API's driver and psql resolve it, and refuses anything they
 * would not agree on, rather than accepting a loopback hostname beside a query
 * parameter that moves the connection elsewhere.
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

/**
 * Query keys that can move the connection away from the authority and pathname
 * the URL appears to name. psql/libpq honour `dbname` and `service` while
 * node-postgres overwrites `database` from the pathname, and both honour
 * `host`/`port`, so the two consumers can disagree about one URL. A URL that
 * carries one of these is refused rather than resolved by guessing.
 */
const TARGET_QUERY_KEYS = new Set([
  'host',
  'hostaddr',
  'port',
  'dbname',
  'database',
  'user',
  'password',
  'passfile',
  'service',
])

// Names that reach psql as-is and are decoded by the API driver. A name outside
// this set is either ambiguous between the two or not a name this harness uses.
const DATABASE_NAME_PATTERN = /^[A-Za-z0-9_]+$/

function isProtectedDatabase(name) {
  return (
    PROTECTED_DATABASES.has(name) ||
    (name.startsWith('obiter_lane_') && !name.endsWith('_test'))
  )
}

/**
 * Resolve the one database this run may touch, and refuse everything else.
 *
 * The returned `url` is the URL that must be handed to the launched API, the
 * psql fixtures and the corpus boots. Validating a copy of the argument while
 * the child still receives the raw string is the defect this function exists to
 * prevent, so callers use `target.url` and nothing else.
 *
 * Refused: missing, unparseable or non-`postgres` URLs, non-loopback hosts,
 * target-affecting query parameters, missing, encoded or oddly-named databases,
 * shared/cluster/lane-development databases (even with `--allow-database`), and
 * any database outside this harness's owned set.
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
  for (const key of parsed.searchParams.keys()) {
    if (TARGET_QUERY_KEYS.has(key.toLowerCase())) {
      throw new FixtureRefusal(
        'database_url_query_override',
        `Refusing "${key}" in the DATABASE_URL query: it can move the connection away from the database the URL names.`,
      )
    }
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '')
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new FixtureRefusal(
      'database_not_loopback',
      host === ''
        ? 'Refusing a DATABASE_URL with no host: fixtures and migrations are only written to a loopback database this task owns.'
        : `Refusing ${host}: fixtures and migrations are only written to a loopback database this task owns.`,
    )
  }
  const rawName = parsed.pathname.replace(/^\//, '')
  if (rawName === '') {
    throw new FixtureRefusal(
      'database_name_missing',
      'Refusing a DATABASE_URL that names no database.',
    )
  }
  let name
  try {
    name = decodeURIComponent(rawName)
  } catch {
    throw new FixtureRefusal(
      'database_name_encoded',
      'Refusing a DATABASE_URL whose database name is not valid percent-encoding.',
    )
  }
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
    // The override names this URL's database or it is ignored. A protected name
    // cannot reach here: `name` was refused above when it was one.
    if (allowDatabase === name) return { name, url: databaseUrl }
  }
  if (OWNED_DATABASES.some((pattern) => pattern.test(name))) {
    return { name, url: databaseUrl }
  }
  throw new FixtureRefusal(
    'database_not_owned',
    `Refusing to target "${name}". This harness owns only ` +
      'obiter_test, obiter_api_runtime, obiter_api_ingress and obiter_lane_<name>_test databases. ' +
      `Pass --allow-database=${name} only if that is deliberate.`,
  )
}
