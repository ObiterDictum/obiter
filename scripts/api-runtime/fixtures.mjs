/*
 * Task-owned fixtures for the API runtime harness, and the guards that keep
 * them out of every other database.
 *
 * The sessions are ordinary `sessions` rows written with psql and validated by
 * better-auth on each request — not an auth bypass. Every route that mints a
 * session needs email (sign-up verification, magic link, reset), which this
 * harness must never trigger, so the row is provisioned directly and then
 * proved by `GET /api/me` before any check trusts it. That proof is also what
 * ties the database psql writes to the database the API reads.
 */
import { randomBytes } from 'node:crypto'

const TAG_PATTERN = /^[a-z0-9]{4,32}$/

/** Databases this harness may write fixtures into. */
const OWNED_DATABASES = [
  /^obiter_test$/,
  /^obiter_api_runtime(_test)?$/,
  /^obiter_lane_[a-z0-9_]+(_test)?$/,
]

export class FixtureRefusal extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'FixtureRefusal'
    this.code = code
  }
}

/**
 * Refuse every database that is not this task's, an ephemeral CI database, or a
 * lane's own. The shared product database is named `obiter`, which matches none
 * of the patterns, so pointing the harness at it fails before any write.
 */
export function assertOwnedDatabase({ databaseUrl, allowDatabase = null }) {
  let parsed
  try {
    parsed = new URL(databaseUrl)
  } catch {
    throw new FixtureRefusal(
      'database_url_unparseable',
      `--database-url is not a URL, so the target database cannot be named.`,
    )
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '')
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new FixtureRefusal(
      'database_not_loopback',
      `Refusing ${host}: fixtures are only written to a loopback database this task owns.`,
    )
  }
  const name = parsed.pathname.replace(/^\//, '')
  if (allowDatabase === name) return name
  if (OWNED_DATABASES.some((pattern) => pattern.test(name))) return name
  throw new FixtureRefusal(
    'database_not_owned',
    `Refusing to write fixtures into "${name}". This harness owns only ` +
      'obiter_api_runtime, obiter_test and obiter_lane_* databases. Pass ' +
      '--allow-database=<name> only if that is deliberate.',
  )
}

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
  // No dot in the token: better-auth reads a dotted value as a signed payload
  // and answers 401 rather than a distinguishable error.
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

/**
 * Two tenants in one transaction: the measured one and the one whose matter
 * every cross-tenant check must be refused. Both get a matter so the refusal
 * cannot be blamed on the matter being absent.
 */
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

/**
 * Prove the provisioned session and, when asked, create the run's matter
 * through the product's own route so the fixture travels the real boundary.
 */
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
