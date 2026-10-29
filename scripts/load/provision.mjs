import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { duplicates } from './metrics.mjs'
import { ProvisionError } from './psql.mjs'

export { ProvisionError }

const TAG_PATTERN = /^[a-z0-9]{4,32}$/

export function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null'
  return `'${String(value).replaceAll("'", "''")}'`
}

export function newRunTag() {
  return randomBytes(8).toString('hex')
}

export function fixtureIds(tag) {
  if (!TAG_PATTERN.test(tag))
    throw new ProvisionError(
      'invalid_run_tag',
      `Run tag "${tag}" is not a lowercase alphanumeric tag; refusing to build fixture SQL from it.`,
    )
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

export async function provisionFixtures({
  target,
  querier,
  fetchImpl = fetch,
  tag = newRunTag(),
  ids = fixtureIds(tag),
  onSqlWritten = null,
}) {
  querier.exec(provisionSql(ids))
  onSqlWritten?.()

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

export async function verifyRun({
  querier,
  ids,
  storageRoot,
  expectedReady,
  statFile = stat,
}) {
  const versions = querier.rows(versionRowsSql(ids.matterId))
  const documents = querier.rows(documentRowsSql(ids.matterId))
  const audit = querier.rows(auditCountsSql(ids.organisationId))

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
  const auditByAction = Object.fromEntries(
    audit.map((row) => [row.action, row.count]),
  )
  const auditExpected = {
    'document.upload': expectedReady,
    'document.version_create': expectedReady,
    'matter.create': 1,
  }
  return {
    documentCount: documents.length,
    versionCount: versions.length,
    readyCount: ready.length,
    failedCount: versions.filter((row) => row.document_status === 'failed')
      .length,
    expectedReady,
    readyMatchesExpected: ready.length === expectedReady,
    versionCountMatchesDocuments: versions.length === documents.length,
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
    auditByAction,
    auditExpected,
    auditMatchesExpected: Object.entries(auditExpected).every(
      ([action, count]) => auditByAction[action] === count,
    ),
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

export async function createScratchDirectory() {
  return mkdtemp(join(tmpdir(), 'obiter-q3-load-'))
}

export async function removeScratchDirectory(directory) {
  await rm(directory, { recursive: true, force: true })
}
