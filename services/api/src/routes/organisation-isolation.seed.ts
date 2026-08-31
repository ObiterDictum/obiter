import { createHash, randomUUID } from 'node:crypto'
import type { Pool } from 'pg'

const CONTENT_SHA256 = 'a'.repeat(64)

export type OrganisationIsolationSeed = {
  suffix: string
  orgA: string
  orgB: string
  userA: string
  userB: string
  matterA: string
  matterB: string
  documentA: string
  documentB: string
  versionA: string
  versionB: string
  shareA: string
  shareB: string
  shareBToA: string
  runA: string
  runB: string
  auditA: string
  auditB: string
  artifactA: string
  artifactB: string
  inviteA: string
  inviteB: string
}

type TenantIds = {
  orgId: string
  userId: string
  matterId: string
  documentId: string
  versionId: string
  shareId: string
  runId: string
  auditId: string
  artifactId: string
  inviteId: string
}

function tenantIds(suffix: string, label: 'a' | 'b'): TenantIds {
  return {
    orgId: `org_iso_${suffix}_${label}`,
    userId: `usr_iso_${suffix}_${label}`,
    matterId: `mtr_iso_${suffix}_${label}`,
    documentId: `doc_iso_${suffix}_${label}`,
    versionId: `ver_iso_${suffix}_${label}`,
    shareId: `shr_iso_${suffix}_${label}`,
    runId: `red_iso_${suffix}_${label}`,
    auditId: `aud_iso_${suffix}_${label}`,
    artifactId: `art_iso_${suffix}_${label}`,
    inviteId: `inv_iso_${suffix}_${label}`,
  }
}

function versionObjectKey(
  orgId: string,
  matterId: string,
  documentId: string,
  versionId: string,
) {
  return `org/${orgId}/matters/${matterId}/documents/${documentId}/versions/${versionId}/source`
}

function versionTextObjectKey(
  orgId: string,
  matterId: string,
  documentId: string,
  versionId: string,
) {
  return `org/${orgId}/matters/${matterId}/documents/${documentId}/versions/${versionId}/text`
}

function artifactObjectKey(
  orgId: string,
  matterId: string,
  artifactId: string,
) {
  return `org/${orgId}/matters/${matterId}/artifacts/${artifactId}`
}

async function seedTenant(pool: Pool, suffix: string, label: 'a' | 'b') {
  const ids = tenantIds(suffix, label)
  const email = `iso-${suffix}-${label}@example.com`

  await pool.query(
    `insert into organisations (id, name, created_at, updated_at)
     values ($1, $2, now(), now())`,
    [ids.orgId, `Isolation Org ${label.toUpperCase()} ${suffix}`],
  )

  await pool.query(
    `insert into users (
       id, name, email, "emailVerified", "organisationId", role,
       "createdAt", "updatedAt"
     )
     values ($1, $2, $3, true, $4, 'owner', now(), now())`,
    [ids.userId, `Isolation User ${label.toUpperCase()}`, email, ids.orgId],
  )

  await pool.query(
    `insert into matters (
       id, organisation_id, name, description, primary_jurisdiction,
       secondary_jurisdictions, legal_domains, client_reference,
       status, created_by, created_at, updated_at
     )
     values ($1, $2, $3, null, 'england_and_wales', '[]'::jsonb, '[]'::jsonb, '', 'active', $4, now(), now())`,
    [ids.matterId, ids.orgId, `Isolation matter ${label}`, ids.userId],
  )

  await pool.query(
    `insert into matter_documents (
       id, organisation_id, matter_id, logical_key, created_by, created_at, updated_at
     )
     values ($1, $2, $3, $4, $5, now(), now())`,
    [
      ids.documentId,
      ids.orgId,
      ids.matterId,
      `key_iso_${suffix}_${label}`,
      ids.userId,
    ],
  )

  const objectKey = versionObjectKey(
    ids.orgId,
    ids.matterId,
    ids.documentId,
    ids.versionId,
  )
  const textObjectKey = versionTextObjectKey(
    ids.orgId,
    ids.matterId,
    ids.documentId,
    ids.versionId,
  )

  await pool.query(
    `insert into document_versions (
       id, organisation_id, matter_id, matter_document_id, filename, file_type,
       size_bytes, object_key, text_object_key, document_status, failure_reason,
       version_number, content_sha256, sync_state, created_by, created_at, updated_at
     )
     values ($1, $2, $3, $4, $5, 'txt', 12, $6, $7, 'ready', null, 1, $8, 'synced', $9, now(), now())`,
    [
      ids.versionId,
      ids.orgId,
      ids.matterId,
      ids.documentId,
      `${ids.documentId}.txt`,
      objectKey,
      textObjectKey,
      CONTENT_SHA256,
      ids.userId,
    ],
  )

  await pool.query(
    `update matter_documents
     set current_version_id = $1, updated_at = now()
     where id = $2 and organisation_id = $3`,
    [ids.versionId, ids.documentId, ids.orgId],
  )

  await pool.query(
    `insert into artifacts (
       id, organisation_id, matter_id, document_id, document_version_id,
       artifact_type, status, object_key, created_by, created_at, updated_at
     )
     values ($1, $2, $3, $4, $5, 'redaction_output', 'ready', $6, $7, now(), now())`,
    [
      ids.artifactId,
      ids.orgId,
      ids.matterId,
      ids.documentId,
      ids.versionId,
      artifactObjectKey(ids.orgId, ids.matterId, ids.artifactId),
      ids.userId,
    ],
  )

  await pool.query(
    `insert into redaction_runs (
       id, organisation_id, matter_id, document_id, document_version_id,
       source_filename, source_text_object_key, source_file_object_key,
       source_layout_object_key, source_mime_type, status, policy_mode,
       spans_json, decisions_json, output_artifact_id, summary_json,
       detector_version, detection_mode, replaces_run_id,
       created_by, created_at, updated_at
     )
     values (
       $1, $2, $3, $4, $5, $6, null, null, null, null, 'finalized',
       'internal_ai_minimisation', '[]'::jsonb, '{}'::jsonb, $7, '{}'::jsonb,
       'detector-1', 'model+supplement', null, $8, now(), now()
     )`,
    [
      ids.runId,
      ids.orgId,
      ids.matterId,
      ids.documentId,
      ids.versionId,
      `${ids.documentId}.txt`,
      ids.artifactId,
      ids.userId,
    ],
  )

  await pool.query(
    `insert into matter_shares (
       id, organisation_id, matter_id, grantee_user_id, access_level,
       created_by, created_at
     )
     values ($1, $2, $3, $4, 'view', $5, now())`,
    [ids.shareId, ids.orgId, ids.matterId, ids.userId, ids.userId],
  )

  await pool.query(
    `insert into audit_logs (
       id, organisation_id, user_id, entity_type, entity_id, action,
       metadata_json, request_id, created_at
     )
     values ($1, $2, $3, 'redaction_run', $4, 'redaction.finalize', '{}'::jsonb, $5, now())`,
    [ids.auditId, ids.orgId, ids.userId, ids.runId, `req_iso_${suffix}`],
  )

  const inviteId = `inv_iso_${suffix}_${label}`
  await pool.query(
    `insert into organisation_invites (
       id, organisation_id, email, role, token_hash, expires_at, created_by
     )
     values ($1, $2, $3, 'member', $4, now() + interval '7 days', $5)`,
    [
      inviteId,
      ids.orgId,
      `invite-${suffix}-${label}@example.com`,
      createHash('sha256').update(`token-${suffix}-${label}`).digest('hex'),
      ids.userId,
    ],
  )

  return { ...ids, inviteId }
}

export async function seedOrganisationIsolation(
  pool: Pool,
): Promise<OrganisationIsolationSeed> {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const tenantA = await seedTenant(pool, suffix, 'a')
  const tenantB = await seedTenant(pool, suffix, 'b')
  const shareBToA = `shr_iso_${suffix}_b2a`

  // Probe: a share of B's matter to A's user. organisation_id on getMatter
  // must still hide it; the access predicate alone would not.
  await pool.query(
    `insert into matter_shares (
       id, organisation_id, matter_id, grantee_user_id, access_level,
       created_by, created_at
     )
     values ($1, $2, $3, $4, 'view', $5, now())`,
    [
      shareBToA,
      tenantB.orgId,
      tenantB.matterId,
      tenantA.userId,
      tenantB.userId,
    ],
  )

  return {
    suffix,
    orgA: tenantA.orgId,
    orgB: tenantB.orgId,
    userA: tenantA.userId,
    userB: tenantB.userId,
    matterA: tenantA.matterId,
    matterB: tenantB.matterId,
    documentA: tenantA.documentId,
    documentB: tenantB.documentId,
    versionA: tenantA.versionId,
    versionB: tenantB.versionId,
    shareA: tenantA.shareId,
    shareB: tenantB.shareId,
    shareBToA,
    runA: tenantA.runId,
    runB: tenantB.runId,
    auditA: tenantA.auditId,
    auditB: tenantB.auditId,
    artifactA: tenantA.artifactId,
    artifactB: tenantB.artifactId,
    inviteA: tenantA.inviteId,
    inviteB: tenantB.inviteId,
  }
}

export async function cleanupOrganisationIsolation(
  pool: Pool,
  seed: OrganisationIsolationSeed,
): Promise<void> {
  const auditIds = [seed.auditA, seed.auditB]
  const inviteIds = [seed.inviteA, seed.inviteB]
  const shareIds = [seed.shareA, seed.shareB, seed.shareBToA]
  const runIds = [seed.runA, seed.runB]
  const artifactIds = [seed.artifactA, seed.artifactB]
  const versionIds = [seed.versionA, seed.versionB]
  const documentIds = [seed.documentA, seed.documentB]
  const matterIds = [seed.matterA, seed.matterB]
  const userIds = [seed.userA, seed.userB]
  const orgIds = [seed.orgA, seed.orgB]

  await pool.query(
    `delete from organisation_invites where id = any($1::text[])`,
    [inviteIds],
  )
  await pool.query(`delete from audit_logs where id = any($1::text[])`, [
    auditIds,
  ])
  await pool.query(`delete from matter_shares where id = any($1::text[])`, [
    shareIds,
  ])
  await pool.query(`delete from redaction_runs where id = any($1::text[])`, [
    runIds,
  ])
  await pool.query(`delete from artifacts where id = any($1::text[])`, [
    artifactIds,
  ])
  await pool.query(
    `update matter_documents
     set current_version_id = null, updated_at = now()
     where id = any($1::text[])`,
    [documentIds],
  )
  await pool.query(`delete from document_versions where id = any($1::text[])`, [
    versionIds,
  ])
  await pool.query(`delete from matter_documents where id = any($1::text[])`, [
    documentIds,
  ])
  await pool.query(`delete from matters where id = any($1::text[])`, [
    matterIds,
  ])
  await pool.query(`delete from users where id = any($1::text[])`, [userIds])
  await pool.query(`delete from organisations where id = any($1::text[])`, [
    orgIds,
  ])
}
