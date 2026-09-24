/*
 * The endpoints and database the e2e journey is allowed to touch.
 *
 * The journey creates a synthetic account, marks it verified with psql and
 * signs in through the UI; all three steps must hit the same explicitly
 * selected test API and the same explicitly selected test database. The spec
 * used to default its sign-up origin to the shared dev API on
 * `127.0.0.1:8787`, so a run with a task database configured but no origin
 * created the user in the shared `obiter` database while the psql update ran
 * against the task database — sign-in then failed, and synthetic `e2e-*` users
 * accumulated in shared data.
 *
 * So there is no default here. The origin comes from the same resolver the
 * Playwright config and global setup use (`resolveLaneTargets`: process
 * environment first, worktree `.env` second) and must be a loopback,
 * non-shared endpoint; the ports the servers are started on must not be the
 * shared dev ports; and the database comes from the same
 * `OBITER_E2E_DATABASE_URL` the API server is started with, which must name a
 * task-owned database. Anything absent, unparseable, shared or mutually
 * inconsistent throws — and journey.spec.ts resolves this at module load,
 * before any test runs, hence before any account exists to leak.
 *
 * This is a `.mjs` next to lane-target.mjs so the spec, the node:test suite
 * and Playwright's loader all use it without a transform.
 */
import {
  resolveLaneTargets,
  SHARED_API_PORT,
  SHARED_WEB_PORT,
} from './lane-target.mjs'

/** The shared dev database on the shared Postgres container. */
const SHARED_DATABASE = 'obiter'

/** The journey only ever talks to servers on this machine. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

/**
 * Resolve the journey's API origin and verification database, or throw.
 *
 * The spec calls this at module load, so a run that cannot name an isolated
 * stack fails before the first test — and therefore before sign-up — instead
 * of silently writing a synthetic account to shared services.
 */
export function resolveJourneyTargets(options = {}) {
  const processEnv = options.processEnv ?? process.env
  const targets = resolveLaneTargets({ ...options, processEnv })

  return {
    apiOrigin: readApiOrigin(targets),
    // The web origin the sign-in leg and the sign-up Origin header use; built
    // from the same resolver, so the header names the isolated web server
    // instead of a hardcoded shared one.
    webOrigin: targets.webOrigin,
    databaseName: readTaskDatabaseName(processEnv),
  }
}

function readApiOrigin(targets) {
  const raw = targets.apiOrigin
  if (raw === undefined || raw === null || raw === '') {
    throw new Error(
      'No API origin: OBITER_API_ORIGIN is empty and nothing else configures one. ' +
        'The journey no longer defaults to the shared dev API on 8787; set OBITER_API_ORIGIN ' +
        "to this run's isolated API (or PORT to its port) in the run environment or the " +
        'worktree .env.',
    )
  }

  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error(
      `The API origin "${raw}" is not a valid URL. Set OBITER_API_ORIGIN to an origin ` +
        'like http://127.0.0.1:8789.',
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `The API origin "${raw}" is not an http(s) origin. The journey only talks to a ` +
        'local test API over http.',
    )
  }

  const port = url.port
    ? Number(url.port)
    : url.protocol === 'https:'
      ? 443
      : 80
  if (port === SHARED_API_PORT || port === SHARED_WEB_PORT) {
    throw new Error(
      `The API origin "${raw}" is the shared dev stack (port ${port}), which this machine ` +
        `reserves for obiter-live. The journey refuses it: signing up there creates synthetic ` +
        `users in the shared database. Point OBITER_API_ORIGIN at this run's isolated API ` +
        `(and set PORT so the server is started there too).`,
    )
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(
      `The API origin "${raw}" is not a loopback address. The journey only runs against a ` +
        'local, isolated test API; refusing a remote host that could be a shared deployment.',
    )
  }

  // The origin can be fine while the server itself would still be started on a
  // shared port (for example OBITER_API_ORIGIN set with PORT unset), which
  // would aim the whole run at obiter-live's stack.
  if (targets.apiPort === SHARED_API_PORT) {
    throw new Error(
      `PORT resolves to the shared API port ${SHARED_API_PORT}. Set PORT to this run's ` +
        `isolated API port in the run environment or the worktree .env.`,
    )
  }
  if (targets.webPort === SHARED_WEB_PORT) {
    throw new Error(
      `OBITER_WEB_PORT resolves to the shared web port ${SHARED_WEB_PORT}. Set it to this ` +
        "run's isolated web port in the run environment or the worktree .env.",
    )
  }

  return raw
}

function readTaskDatabaseName(processEnv) {
  const raw = processEnv.OBITER_E2E_DATABASE_URL
  if (raw === undefined || raw === null || raw === '') {
    throw new Error(
      'OBITER_E2E_DATABASE_URL is not set. The journey verifies its user with psql and must ' +
        'target the same explicitly selected test database the API server is started with; it ' +
        'used to fall back to the shared `obiter` database. Set OBITER_E2E_DATABASE_URL to ' +
        "this run's task-owned database (and OBITER_E2E_DATABASE_NAME to the same name, if " +
        'you set it at all).',
    )
  }

  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`OBITER_E2E_DATABASE_URL is not a valid URL: "${raw}".`)
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(
      `OBITER_E2E_DATABASE_URL must be a postgres URL; got "${raw}".`,
    )
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (databaseName === '') {
    throw new Error(`OBITER_E2E_DATABASE_URL names no database: "${raw}".`)
  }
  if (databaseName === SHARED_DATABASE) {
    throw new Error(
      `OBITER_E2E_DATABASE_URL points at the shared dev database \`${SHARED_DATABASE}\`. ` +
        'The journey refuses it: its synthetic e2e-* accounts belong in a task-owned ' +
        'database, never in shared data.',
    )
  }

  const declared = processEnv.OBITER_E2E_DATABASE_NAME
  if (
    declared !== undefined &&
    declared !== null &&
    declared !== '' &&
    declared !== databaseName
  ) {
    throw new Error(
      `OBITER_E2E_DATABASE_NAME="${declared}" does not name the database ` +
        `OBITER_E2E_DATABASE_URL points at ("${databaseName}"). Verification would update a ` +
        'database the API never reads.',
    )
  }

  return databaseName
}
