import { randomBytes } from 'node:crypto'
import { FixtureRefusal } from './database-target.mjs'

export { FixtureRefusal }

const TAG_PATTERN = /^[a-z0-9]{4,32}$/

export function newRunTag() {
  return randomBytes(8).toString('hex')
}

export function fixtureIds(tag) {
  if (!TAG_PATTERN.test(tag)) {
    throw new FixtureRefusal(
      'invalid_run_tag',
      `Run tag "${tag}" is not a lowercase alphanumeric tag; refusing to build fixture SQL from it.`,
    )
  }
  const token = (label) =>
    `apirt${label}${tag}${randomBytes(16).toString('hex')}`
  return {
    tag,
    organisationId: `org_apirt_${tag}`,
    userId: `usr_apirt_${tag}`,
    sessionId: `ses_apirt_${tag}`,
    sessionToken: token('a'),
    otherOrganisationId: `org_apirt_${tag}b`,
    otherUserId: `usr_apirt_${tag}b`,
    otherSessionId: `ses_apirt_${tag}b`,
    otherSessionToken: token('b'),
    matterId: `mtr_apirt_${tag}`,
    otherMatterId: `mtr_apirt_${tag}b`,
    organisationName: `API runtime ${tag}`,
    matterName: `API runtime matter ${tag}`,
    otherMatterName: `API runtime other matter ${tag}`,
    email: `api-runtime-${tag}@obiter.test`,
    otherEmail: `api-runtime-${tag}b@obiter.test`,
  }
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

export function provisionSql(ids) {
  return `
begin;
insert into organisations (id, name) values
  (${sqlLiteral(ids.organisationId)}, ${sqlLiteral(ids.organisationName)}),
  (${sqlLiteral(ids.otherOrganisationId)}, ${sqlLiteral(`${ids.organisationName} B`)});
insert into users (id, name, email, "emailVerified", "organisationId", role) values
  (${sqlLiteral(ids.userId)}, 'API runtime user', ${sqlLiteral(ids.email)}, true, ${sqlLiteral(ids.organisationId)}, 'owner'),
  (${sqlLiteral(ids.otherUserId)}, 'API runtime user B', ${sqlLiteral(ids.otherEmail)}, true, ${sqlLiteral(ids.otherOrganisationId)}, 'owner');
insert into sessions (id, "expiresAt", token, "userId", "userAgent") values
  (${sqlLiteral(ids.sessionId)}, now() + interval '2 hours', ${sqlLiteral(ids.sessionToken)}, ${sqlLiteral(ids.userId)}, 'obiter-api-runtime-harness'),
  (${sqlLiteral(ids.otherSessionId)}, now() + interval '2 hours', ${sqlLiteral(ids.otherSessionToken)}, ${sqlLiteral(ids.otherUserId)}, 'obiter-api-runtime-harness');
insert into matters (organisation_id, id, name, primary_jurisdiction, created_by) values
  (${sqlLiteral(ids.organisationId)}, ${sqlLiteral(ids.matterId)}, ${sqlLiteral(ids.matterName)}, 'england_and_wales', ${sqlLiteral(ids.userId)}),
  (${sqlLiteral(ids.otherOrganisationId)}, ${sqlLiteral(ids.otherMatterId)}, ${sqlLiteral(ids.otherMatterName)}, 'england_and_wales', ${sqlLiteral(ids.otherUserId)});
commit;
`.trim()
}

export function auditCountSql(organisationId) {
  return `select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (select count(*)::int as count from audit_logs where organisation_id = ${sqlLiteral(organisationId)}) r`
}

export function documentCountSql(matterId) {
  return `select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (select count(*)::int as count from matter_documents where matter_id = ${sqlLiteral(matterId)}) r`
}

export function matterCountSql(organisationId, namePrefix) {
  return (
    `select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (` +
    `select count(*)::int as count from matters where organisation_id = ${sqlLiteral(organisationId)}` +
    ` and name like ${sqlLiteral(`${namePrefix}%`)}) r`
  )
}

export function auditActionsSql(organisationId) {
  return `select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (select action from audit_logs where organisation_id = ${sqlLiteral(organisationId)}) r`
}

export function readyDocumentSql(matterId) {
  return `
select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (
  select d.id as document_id, v.id as version_id, v.size_bytes
  from matter_documents d
  join document_versions v on v.id = d.current_version_id
  where d.matter_id = ${sqlLiteral(matterId)} and v.document_status = 'ready'
  order by v.created_at desc
) r`.trim()
}

export function foreignReadyDocumentSql(otherOrganisationId) {
  return `
select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (
  select d.id as document_id
  from matter_documents d
  join document_versions v on v.id = d.current_version_id
  where d.organisation_id = ${sqlLiteral(otherOrganisationId)} and v.document_status = 'ready'
  limit 1
) r`.trim()
}

export async function proveSession({ origin, ids, fetchImpl = fetch }) {
  const response = await fetchImpl(`${origin}/api/me`, {
    headers: { Authorization: `Bearer ${ids.sessionToken}` },
    signal: AbortSignal.timeout(10_000),
  })
  const body = await response.json().catch(() => null)
  if (
    response.status !== 200 ||
    body?.user?.id !== ids.userId ||
    body?.organisation?.id !== ids.organisationId
  ) {
    throw new FixtureRefusal(
      'session_not_accepted',
      `The provisioned session was not accepted by ${origin}/api/me ` +
        `(status ${response.status}). The database psql wrote and the database the API reads differ.`,
    )
  }
}
