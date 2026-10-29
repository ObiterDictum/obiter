import {
  resolveLaneTargets,
  SHARED_API_PORT,
  SHARED_WEB_PORT,
} from './lane-target.mjs'

const SHARED_DATABASE = 'obiter'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export function resolveJourneyTargets(options = {}) {
  const processEnv = options.processEnv ?? process.env
  const targets = resolveLaneTargets({ ...options, processEnv })

  return {
    apiOrigin: readApiOrigin(targets),
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
