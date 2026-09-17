/*
 * Which API this load run is allowed to measure, and proof that it belongs to
 * this lane.
 *
 * A load harness that measures the wrong server produces confident numbers for
 * someone else's code, and the shared stack on 3000/8787 is the natural
 * accident: it answers on the default ports from a different worktree. So the
 * targets come from the lane's own bounded resolver
 * (`apps/web/lane-target.mjs`, the same one the e2e suite uses), the shared
 * ports are refused, the origin must be loopback, the resolved database must
 * be this lane's, and `/api/health` provenance must name this checkout and
 * commit before a single upload is sent.
 *
 * The database name is resolved from the lane's `.env`, not from the API: the
 * API does not report its database, so the tie is proved instead by the
 * provisioned session — a token written into that database must authenticate
 * against that API or the run stops. See `provision.mjs`.
 */
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import {
  assertLaneTargets,
  resolveLaneTargets,
  WORKTREE_ROOT,
} from '../../apps/web/lane-target.mjs'

export class TargetRefusal extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'TargetRefusal'
    this.code = code
  }
}

/** `lane-security` owns the `obiter_lane_security` database. */
export function expectedLaneDatabase(worktreeRoot) {
  const folder = basename(worktreeRoot)
  if (!folder.startsWith('lane-'))
    throw new TargetRefusal(
      'not_a_lane',
      `${worktreeRoot} is not a lane worktree (expected a folder named lane-<name>). ` +
        'Load runs are only for lanes; the shared stack and plain checkouts are not measurable targets.',
    )
  return `obiter_lane_${folder.slice('lane-'.length).replaceAll('-', '_')}`
}

export function databaseNameFromUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new TargetRefusal(
      'database_url_unparseable',
      'DATABASE_URL is not a URL, so the target database cannot be named.',
    )
  }
  const name = parsed.pathname.replace(/^\//, '')
  if (!name)
    throw new TargetRefusal(
      'database_url_unparseable',
      'DATABASE_URL names no database, so the target database cannot be verified.',
    )
  return name
}

/**
 * Minimal `KEY=value` reader for a lane `.env`. The process environment wins,
 * matching `loadLocalEnvFile`'s documented rule in `services/api/src/env.ts`
 * so the harness and the API resolve the same value from the same file.
 */
export function readEnvAssignment(text, key, processEnv = {}) {
  if (processEnv[key]) return processEnv[key]
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator === -1) continue
    if (line.slice(0, separator).trim() !== key) continue
    const value = line.slice(separator + 1).trim()
    const unquoted = value.replace(/^(['"])(.*)\1$/, '$2')
    if (unquoted === '') continue
    return unquoted
  }
  return null
}

/** Loopback only: a non-local origin may be shared or a live environment. */
export function assertLoopbackOrigin(origin) {
  // `new URL` keeps the brackets on an IPv6 literal, so compare both forms.
  const host = new URL(origin).hostname.replace(/^\[|\]$/g, '')
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1')
    throw new TargetRefusal(
      'origin_not_loopback',
      `Refusing to load-test ${origin}: only a loopback origin belongs to this machine's lane.`,
    )
}

/**
 * Resolve and prove the whole target chain. Throws `TargetRefusal` rather than
 * returning a partially verified target.
 */
export async function resolveLoadTarget({
  worktreeRoot = WORKTREE_ROOT,
  expectCommit,
  allowDatabase,
  fetchImpl = fetch,
  processEnv = process.env,
  read = readFile,
} = {}) {
  const targets = resolveLaneTargets({
    startDirectory: worktreeRoot,
    processEnv,
  })
  assertLaneTargets(targets, { reuseExistingServer: true })
  assertLoopbackOrigin(targets.apiOrigin)

  if (!targets.envFile)
    throw new TargetRefusal(
      'no_lane_env',
      `No .env in ${worktreeRoot}, so the lane's database cannot be identified.`,
    )

  const expectedDatabase = expectedLaneDatabase(worktreeRoot)
  const envText = await read(targets.envFile, 'utf8')
  const databaseUrl = readEnvAssignment(envText, 'DATABASE_URL', processEnv)
  if (!databaseUrl)
    throw new TargetRefusal(
      'no_database_url',
      `DATABASE_URL is absent from the process environment and from ${targets.envFile}, ` +
        'so the harness cannot provision or verify fixtures.',
    )

  const databaseName = databaseNameFromUrl(databaseUrl)
  if (allowDatabase !== databaseName && databaseName !== expectedDatabase)
    throw new TargetRefusal(
      'database_not_this_lane',
      `Refusing to write fixtures into database "${databaseName}": ${worktreeRoot} owns ` +
        `"${expectedDatabase}". Pass --allow-database ${databaseName} only if this is deliberate.`,
    )

  const health = await fetchHealth(targets.apiOrigin, fetchImpl)
  const provenance = health.provenance
  if (!provenance || typeof provenance.checkoutRoot !== 'string')
    throw new TargetRefusal(
      'api_provenance_missing',
      `The API at ${targets.apiOrigin} reported no development provenance, so its checkout cannot be attributed.`,
    )
  if (provenance.checkoutRoot !== worktreeRoot)
    throw new TargetRefusal(
      'api_checkout_mismatch',
      `The API at ${targets.apiOrigin} serves ${provenance.checkoutRoot}, not ${worktreeRoot}.`,
    )
  if (expectCommit && provenance.commitSha !== expectCommit)
    throw new TargetRefusal(
      'api_commit_mismatch',
      `The API at ${targets.apiOrigin} is running ${provenance.commitSha} but this run expects ${expectCommit}. Restart it after a checkout change.`,
    )
  if ((provenance.envFile ?? null) !== targets.envFile)
    throw new TargetRefusal(
      'api_env_mismatch',
      `The API at ${targets.apiOrigin} resolved its configuration from ` +
        `${provenance.envFile ?? 'no .env'} but this lane's is ${targets.envFile}.`,
    )

  return {
    worktreeRoot,
    apiOrigin: targets.apiOrigin,
    apiPort: targets.apiPort,
    envFile: targets.envFile,
    databaseUrl,
    databaseName,
    databaseSource:
      allowDatabase !== databaseName ? 'lane-derived' : 'explicit-flag',
    commitSha: provenance.commitSha,
    health,
  }
}

async function fetchHealth(apiOrigin, fetchImpl) {
  let response
  try {
    response = await fetchImpl(`${apiOrigin}/api/health`, {
      signal: AbortSignal.timeout(5000),
    })
  } catch (error) {
    throw new TargetRefusal(
      'api_unreachable',
      `The API at ${apiOrigin} did not answer /api/health: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!response.ok)
    throw new TargetRefusal(
      'api_unhealthy',
      `The API at ${apiOrigin} answered ${response.status} on /api/health.`,
    )
  return response.json()
}
