/*
 * Synthetic fixtures for one load run: a tenant, a session, a matter to fill,
 * and a second tenant that exists only to be refused.
 *
 * The session is written straight into the lane database because every route
 * that mints one needs email (sign-up verification, magic link, reset), and
 * this harness must not send mail or read one-time URLs from a log. That is
 * fixture provisioning, not an auth bypass: the token is an ordinary
 * `sessions` row that better-auth validates on every request, and the run
 * stops unless `GET /api/me` answers with exactly this synthetic user and
 * organisation. That check is also what proves the database psql writes and
 * the database the API reads are the same one.
 *
 * Reads go through `psql` with a JSON aggregate rather than a delimited one:
 * `failure_reason` is free-ish text, and a tab-delimited read that shifts a
 * column would misreport which uploads failed.
 *
 * psql is invoked synchronously and only outside the measured window; the
 * blocking call must never run while uploads are in flight.
 */
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { duplicates } from './metrics.mjs'

export class ProvisionError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ProvisionError'
    this.code = code
  }
}

const TAG_PATTERN = /^[a-z0-9]{4,32}$/

export function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null'
  return `'${String(value).replaceAll("'", "''")}'`
}

/** A tag that names every row this run creates, so leftovers are obvious. */
export function newRunTag() {
  return randomBytes(8).toString('hex')
}

export function fixtureIds(tag) {
  if (!TAG_PATTERN.test(tag))
    throw new ProvisionError(
      'invalid_run_tag',
      `Run tag "${tag}" is not a lowercase alphanumeric tag; refusing to build fixture SQL from it.`,
    )
  // No separator characters in the token: better-auth treats a token
  // containing a dot as a signed value and answers 401 rather than a
  // distinguishable error. Found by running this harness against the lane.
  const token = (label) =>
    `q3load${label}${tag}${randomBytes(16).toString('hex')}`
  return {
    tag,
    organisationId: `org_q3load_${tag}`,
    userId: `usr_q3load_${tag}`,
    sessionId: `ses_q3load_${tag}`,
    sessionToken: token(''),
    otherOrganisationId: `org_q3load_${tag}b`,
    otherUserId: `usr_q3load_${tag}b`,
    otherSessionToken: token('b'),
    otherMatterId: `mtr_q3load_${tag}b`,
    organisationName: `Q3 load ${tag}`,
    email: `q3-load-${tag}@obiter.test`,
    otherEmail: `q3-load-${tag}b@obiter.test`,
    matterName: `Q3 load matter ${tag}`,
    otherMatterName: `Q3 load refused matter ${tag}`,
  }
}

/**
 * Tenant A (the measured one) and tenant B (the refused one) in one
 * transaction: either both exist or neither does.
 */
export function provisionSql(ids) {
  return `
begin;
insert into organisations (id, name) values
  (${sqlLiteral(ids.organisationId)}, ${sqlLiteral(ids.organisationName)}),
  (${sqlLiteral(ids.otherOrganisationId)}, ${sqlLiteral(`${ids.organisationName} B`)});
insert into users (id, name, email, "emailVerified", "organisationId", role) values
  (${sqlLiteral(ids.userId)}, 'Q3 load user', ${sqlLiteral(ids.email)}, true, ${sqlLiteral(ids.organisationId)}, 'owner'),
  (${sqlLiteral(ids.otherUserId)}, 'Q3 load user B', ${sqlLiteral(ids.otherEmail)}, true, ${sqlLiteral(ids.otherOrganisationId)}, 'owner');
insert into sessions (id, "expiresAt", token, "userId", "userAgent") values
  (${sqlLiteral(ids.sessionId)}, now() + interval '2 hours', ${sqlLiteral(ids.sessionToken)}, ${sqlLiteral(ids.userId)}, 'obiter-q3-load-harness'),
  (${sqlLiteral(`ses_q3load_${ids.tag}b`)}, now() + interval '2 hours', ${sqlLiteral(ids.otherSessionToken)}, ${sqlLiteral(ids.otherUserId)}, 'obiter-q3-load-harness');
insert into matters (organisation_id, id, name, primary_jurisdiction, created_by)
  values (${sqlLiteral(ids.otherOrganisationId)}, ${sqlLiteral(ids.otherMatterId)}, ${sqlLiteral(ids.otherMatterName)}, 'england_and_wales', ${sqlLiteral(ids.otherUserId)});
commit;
`.trim()
}

export function versionRowsSql(matterId) {
  return `
select coalesce(json_agg(row_to_json(rows) order by rows.created_at), '[]'::json)::text
from (
  select v.id as version_id, v.matter_document_id as document_id, v.version_number,
         v.document_status, v.size_bytes, v.content_sha256, v.object_key, v.text_object_key,
         v.failure_reason, v.created_at::text
  from document_versions v
  where v.matter_id = ${sqlLiteral(matterId)}
) rows`.trim()
}

export function documentRowsSql(matterId) {
  return `
select coalesce(json_agg(row_to_json(rows)), '[]'::json)::text
from (
  select d.id as document_id, d.current_version_id, d.created_at::text
  from matter_documents d
  where d.matter_id = ${sqlLiteral(matterId)}
) rows`.trim()
}

export function auditCountsSql(organisationId) {
  return `
select coalesce(json_agg(row_to_json(rows)), '[]'::json)::text
from (
  select action, count(*)::int as count
  from audit_logs
  where organisation_id = ${sqlLiteral(organisationId)}
  group by action
  order by action
) rows`.trim()
}

/** PG* environment from a connection URL: no credential ever reaches argv. */
export function psqlEnvironment(databaseUrl, baseEnv = process.env) {
  const parsed = new URL(databaseUrl)
  return {
    PATH: baseEnv.PATH ?? '',
    HOME: baseEnv.HOME ?? '',
    LANG: baseEnv.LANG ?? 'C',
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: parsed.pathname.replace(/^\//, ''),
    PGCONNECT_TIMEOUT: '5',
    PGAPPNAME: 'obiter-q3-load-harness',
  }
}

/** psql, with the SQL on stdin so no fixture value ever reaches argv. */
function defaultRunner(sql, environment) {
  return execFileSync(
    'psql',
    ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-f', '-'],
    {
      input: sql,
      encoding: 'utf8',
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
}

export function createQuerier({
  databaseUrl,
  baseEnv = process.env,
  run,
} = {}) {
  const environment = psqlEnvironment(databaseUrl, baseEnv)
  const execute = run ?? defaultRunner
  return {
    /** Rows from a `json_agg` query; empty array when nothing matched. */
    rows(sql) {
      const text = execute(sql, environment)
      return JSON.parse(text.trim() === '' ? 'null' : text.trim()) ?? []
    },
    exec(sql) {
      execute(sql, environment)
    },
    environment,
  }
}

/**
 * Create the fixtures, then prove the session works against the API under
 * test. Returns the ids the run reports (never the tokens).
 */
export async function provisionFixtures({
  target,
  querier,
  fetchImpl = fetch,
  tag = newRunTag(),
  ids = fixtureIds(tag),
  onSqlWritten = null,
}) {
  querier.exec(provisionSql(ids))
  // The caller cleans up on any later failure; it needs to know whether the
  // tenant rows exist yet before it can say what was left behind.
  onSqlWritten?.()

  // Prove the session before creating anything through the API: a failure here
  // leaves only the SQL fixtures, and a matter that was never created is a
  // matter that never has to be cleaned up.
  const me = await fetchJson(`${target.apiOrigin}/api/me`, {
    token: ids.sessionToken,
    fetchImpl,
  })
  if (me.status !== 200)
    throw new ProvisionError(
      'auth_precondition_failed',
      `The provisioned session was rejected by ${target.apiOrigin}/api/me with ${me.status}. ` +
        'The database psql wrote and the database the API reads are not the same one, or provenance is stale.',
    )
  if (
    me.body?.user?.id !== ids.userId ||
    me.body?.organisation?.id !== ids.organisationId
  )
    throw new ProvisionError(
      'auth_precondition_mismatch',
      `/api/me answered for a different user or organisation than the provisioned fixture.`,
    )

  const matter = await createMatter({
    apiOrigin: target.apiOrigin,
    token: ids.sessionToken,
    name: ids.matterName,
    fetchImpl,
  })

  return { ...ids, matterId: matter.id, matterName: matter.name }
}

async function createMatter({ apiOrigin, token, name, fetchImpl }) {
  const response = await fetchJson(`${apiOrigin}/api/matters`, {
    token,
    fetchImpl,
    method: 'POST',
    body: { name, primaryJurisdiction: 'england_and_wales' },
  })
  if (response.status !== 201 || typeof response.body?.matter?.id !== 'string')
    throw new ProvisionError(
      'matter_creation_failed',
      `Creating the fixture matter answered ${response.status}; the run cannot start.`,
    )
  return response.body.matter
}

async function fetchJson(url, { token, fetchImpl, method = 'GET', body } = {}) {
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  }
  try {
    const response = await fetchImpl(url, init)
    return {
      status: response.status,
      body: await response.json().catch(() => null),
    }
  } catch (error) {
    throw new ProvisionError(
      'fixture_request_failed',
      `Fixture request to ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Post-run verification from the database, independent of what the API
 * claimed. `storageRoot` is the API's own storage directory (`createLocalStorage`
 * resolves `.obiter-storage` against the API process's working directory,
 * which for a lane is `<worktree>/services/api`).
 */
export async function verifyRun({
  querier,
  ids,
  worktreeRoot,
  expectedReady,
  statFile = stat,
}) {
  const versions = querier.rows(versionRowsSql(ids.matterId))
  const documents = querier.rows(documentRowsSql(ids.matterId))
  const audit = querier.rows(auditCountsSql(ids.organisationId))
  const storageRoot = join(worktreeRoot, 'services', 'api', '.obiter-storage')

  const ready = versions.filter((row) => row.document_status === 'ready')
  const storage = []
  for (const row of versions) {
    const keys = [row.object_key, row.text_object_key].filter(Boolean)
    storage.push({
      versionId: row.version_id,
      present: (
        await Promise.all(
          keys.map((key) => fileExists(join(storageRoot, key), statFile)),
        )
      ).every(Boolean),
      keyCount: keys.length,
    })
  }

  const versionedDocumentIds = new Set(versions.map((row) => row.document_id))
  return {
    documentCount: documents.length,
    versionCount: versions.length,
    readyCount: ready.length,
    failedCount: versions.filter((row) => row.document_status === 'failed')
      .length,
    expectedReady,
    readyMatchesExpected: ready.length === expectedReady,
    // A document with no version row, or a document carrying two versions of
    // one upload run, is a partial or duplicated write even when the counts
    // happen to add up.
    documentsWithoutVersion: documents.filter(
      (row) => !versionedDocumentIds.has(row.document_id),
    ).length,
    readyWithoutTextKey: ready.filter((row) => !row.text_object_key).length,
    duplicateDocumentIds: duplicates(versions.map((row) => row.document_id)),
    duplicateVersionNumbers: duplicates(
      versions.map((row) => `${row.document_id}#${row.version_number}`),
    ),
    distinctContentHashes: new Set(versions.map((row) => row.content_sha256))
      .size,
    storageRoot,
    storage,
    allStoragePresent: storage.every((entry) => entry.present),
    failureReasons: [
      ...new Set(
        versions
          .map((row) => row.failure_reason)
          .filter((reason) => typeof reason === 'string'),
      ),
    ],
    audit,
  }
}

async function fileExists(path, statFile) {
  try {
    await statFile(path)
    return true
  } catch {
    return false
  }
}

/**
 * Clean up through the product's own soft-delete routes, with the session that
 * owns each matter. Audit rows and storage objects are deliberately retained:
 * the harness must not remove audit history or delete storage out of band.
 */
export async function softDeleteFixtures({ target, ids, fetchImpl = fetch }) {
  const deleted = []
  for (const [matterId, token] of [
    [ids.matterId, ids.sessionToken],
    [ids.otherMatterId, ids.otherSessionToken],
  ]) {
    if (!matterId) continue
    const response = await fetchJson(
      `${target.apiOrigin}/api/matters/${matterId}`,
      { token, fetchImpl, method: 'DELETE' },
    )
    deleted.push({ matterId, status: response.status })
  }
  return deleted
}

/**
 * Tenant and matter isolation, checked with the measured session against
 * fixtures it does not own. The assertions are on status codes and on the
 * absence of the other tenant's names — never on private content, and nothing
 * here deletes or mutates another tenant's data.
 */
export async function verifyIsolation({ target, ids, fetchImpl = fetch }) {
  const checks = []
  const missingMatter = `mtr_q3loadabsent${ids.tag}`

  const probes = [
    {
      name: 'other_matter_read',
      path: `/api/matters/${ids.otherMatterId}`,
      expect: 404,
    },
    {
      name: 'other_matter_documents',
      path: `/api/matters/${ids.otherMatterId}/documents`,
      expect: 404,
    },
    {
      name: 'absent_matter_documents',
      path: `/api/matters/${missingMatter}/documents`,
      expect: 404,
    },
    {
      name: 'own_matter_upload_unauthenticated',
      path: `/api/matters/${ids.matterId}/documents`,
      expect: 401,
      token: null,
    },
    {
      name: 'matter_list_unauthenticated',
      path: '/api/matters',
      expect: 401,
      token: null,
    },
  ]

  for (const probe of probes) {
    const response = await rawFetch(`${target.apiOrigin}${probe.path}`, {
      token: probe.token === undefined ? ids.sessionToken : probe.token,
      fetchImpl,
    })
    checks.push({
      name: probe.name,
      expectedStatus: probe.expect,
      status: response.status,
      passed: response.status === probe.expect,
      // A denial that echoes the other tenant's name would be a content leak.
      leakedOtherName:
        probe.name === 'other_matter_read' &&
        response.text.includes(ids.otherMatterName),
    })
  }

  const list = await fetchJson(`${target.apiOrigin}/api/matters`, {
    token: ids.sessionToken,
    fetchImpl,
  })
  const listedIds = (list.body?.matters ?? []).map((matter) => matter.id)
  checks.push({
    name: 'own_matter_list_excludes_other_tenant',
    expectedStatus: 200,
    status: list.status,
    passed: list.status === 200 && !listedIds.includes(ids.otherMatterId),
    leakedOtherName: false,
  })

  return {
    checks,
    allPassed: checks.every((check) => check.passed && !check.leakedOtherName),
  }
}

async function rawFetch(url, { token, fetchImpl, method = 'GET' } = {}) {
  const response = await fetchImpl(url, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(15_000),
  })
  return {
    status: response.status,
    text: await response.text().catch(() => ''),
  }
}

/** Scratch directory for generated fixtures; removed by the caller. */
export async function createScratchDirectory() {
  return mkdtemp(join(tmpdir(), 'obiter-q3-load-'))
}

export async function removeScratchDirectory(directory) {
  await rm(directory, { recursive: true, force: true })
}
