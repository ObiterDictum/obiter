import type { Pool } from 'pg'
import type { MatterAccessLevel } from '@obiter/contracts'
import type { AuthenticatedOrgUser } from './authz'
import { matterAccessPredicate } from './matter-access-boundary'
import { lockDeletedMatterForEdit, lockMatterForEdit } from './matter-lock'
import { appendAuditLog } from './audit-log'
import type {
  CreateMatterInput,
  MatterDocumentRecord,
  MatterRecord,
  RestoreMatterInput,
  UpdateMatterInput,
} from './database-records'
import {
  documentColumns,
  firstOrNull,
  mapDocument,
  mapMatter,
  matterColumns,
  type MatterDocumentRow,
  type MatterRow,
} from './database-rows'

export async function createMatter(
  pool: Pool,
  input: CreateMatterInput,
): Promise<MatterRecord> {
  const result = await pool.query<MatterRow>(
    `
      insert into matters (
        organisation_id, name, description, primary_jurisdiction,
        secondary_jurisdictions, legal_domains, client_reference,
        status, created_by, created_at, updated_at
      )
      values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, 'active', $8, now(), now())
      returning ${matterColumns}
    `,
    [
      input.organisationId,
      input.name,
      input.description ?? null,
      input.primaryJurisdiction,
      JSON.stringify(input.secondaryJurisdictions ?? []),
      JSON.stringify(input.legalDomains ?? []),
      input.clientReference ?? '',
      input.userId,
    ],
  )

  return mapMatter(result.rows[0])
}

export async function listMatters(
  pool: Pool,
  user: AuthenticatedOrgUser,
  options: { includeDeleted?: boolean } = {},
): Promise<MatterRecord[]> {
  const result = await pool.query<MatterRow>(
    `
      select ${matterColumns}
      from matters matter
      where matter.organisation_id = $1
        and ($2::boolean or matter.deleted_at is null)
        and ${matterAccessPredicate('$3', "'view'")}
      order by matter.created_at desc
    `,
    [user.organisationId, options.includeDeleted === true, user.id],
  )

  return result.rows.map(mapMatter)
}

export async function getMatter(
  pool: Pool,
  user: AuthenticatedOrgUser,
  id: string,
  requiredLevel: MatterAccessLevel,
  options: { includeDeleted?: boolean } = {},
): Promise<MatterRecord | null> {
  const result = await pool.query<MatterRow>(
    `
      select ${matterColumns}
      from matters matter
      where matter.id = $1
        and matter.organisation_id = $2
        and ($3::boolean or matter.deleted_at is null)
        and ${matterAccessPredicate('$4', '$5')}
    `,
    [
      id,
      user.organisationId,
      options.includeDeleted === true,
      user.id,
      requiredLevel,
    ],
  )

  return firstOrNull(result, mapMatter)
}

export async function updateMatter(
  pool: Pool,
  user: AuthenticatedOrgUser,
  id: string,
  input: UpdateMatterInput,
): Promise<MatterRecord | null> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    // Matter lock, fresh edit re-check, acting-member lock before the write so
    // a revocation that commits during the request cannot be outrun.
    if (
      !(await lockMatterForEdit(client, {
        organisationId: user.organisationId,
        matterId: id,
        userId: user.id,
      }))
    ) {
      await client.query('rollback')
      return null
    }
    const matterResult = await client.query<MatterRow>(
      `
        update matters matter
        set name = coalesce($3, name),
          description = case when $4::boolean then $5 else description end,
          primary_jurisdiction = coalesce($6, primary_jurisdiction),
          secondary_jurisdictions = case when $7::boolean then $8::jsonb else secondary_jurisdictions end,
          legal_domains = case when $9::boolean then $10::jsonb else legal_domains end,
          client_reference = coalesce($11, client_reference),
          status = coalesce($12, status),
          updated_at = now()
        where matter.id = $1
          and matter.organisation_id = $2
          and matter.deleted_at is null
        returning ${matterColumns}
      `,
      [
        id,
        user.organisationId,
        input.name ?? null,
        Object.hasOwn(input, 'description'),
        input.description ?? null,
        input.primaryJurisdiction ?? null,
        Object.hasOwn(input, 'secondaryJurisdictions'),
        JSON.stringify(input.secondaryJurisdictions ?? []),
        Object.hasOwn(input, 'legalDomains'),
        JSON.stringify(input.legalDomains ?? []),
        input.clientReference ?? null,
        input.status ?? null,
      ],
    )
    await client.query('commit')
    return firstOrNull(matterResult, mapMatter)
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export interface DeleteCascadeResult {
  matter: MatterRecord
  documents: MatterDocumentRecord[]
  runs: { id: string }[]
}

/**
 * Soft-deletes a matter and cascades to its documents and their redaction runs
 * in one transaction, writing one `*.delete` audit row per deleted entity.
 *
 * Provenance: every `set deleted_at = now()` in this transaction shares one
 * transaction-stable timestamp `T`. Already-deleted children are skipped
 * (`where deleted_at is null`), so cascade-restore (below) can match only the
 * children this cascade took down by `deleted_at = T` — an individually-deleted
 * child (older timestamp) is not revived. See docs/prds/platform-deletion.md.
 *
 * Returns null when the matter is missing, cross-org, or already deleted —
 * the caller surfaces a 404 without writing any audit row (no existence leak).
 */
export async function softDeleteMatterWithCascade(
  pool: Pool,
  input: {
    organisationId: string
    userId: string
    id: string
    requestId: string
  },
): Promise<DeleteCascadeResult | null> {
  const client = await pool.connect()

  try {
    await client.query('begin')

    // Matter lock, fresh edit re-check, acting-member lock before the cascade.
    if (
      !(await lockMatterForEdit(client, {
        organisationId: input.organisationId,
        matterId: input.id,
        userId: input.userId,
      }))
    ) {
      await client.query('rollback')
      return null
    }

    const matterResult = await client.query<MatterRow>(
      `
        update matters
        set status = 'deleted', deleted_at = now(), deleted_by = $3, updated_at = now()
        where id = $1 and organisation_id = $2 and deleted_at is null
        returning ${matterColumns}
      `,
      [input.id, input.organisationId, input.userId],
    )
    const matter = firstOrNull(matterResult, mapMatter)
    if (!matter) {
      await client.query('rollback')
      return null
    }

    const documentsResult = await client.query<MatterDocumentRow>(
      `
        update matter_documents
        set deleted_at = now(), deleted_by = $3, updated_at = now()
        where matter_id = $1 and organisation_id = $2 and deleted_at is null
        returning ${documentColumns}
      `,
      [input.id, input.organisationId, input.userId],
    )
    const documents = documentsResult.rows.map(mapDocument)

    const runsResult = await client.query<{ id: string }>(
      `
        update redaction_runs
        set deleted_at = now(), deleted_by = $3, updated_at = now()
        where matter_id = $1 and organisation_id = $2 and deleted_at is null
        returning id
      `,
      [input.id, input.organisationId, input.userId],
    )
    const runs = runsResult.rows

    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.userId,
      entityType: 'matter',
      entityId: matter.id,
      action: 'matter.delete',
      metadata: {
        documentCount: documents.length,
        runCount: runs.length,
      },
      requestId: input.requestId,
    })
    for (const document of documents) {
      await appendAuditLog(client, {
        organisationId: input.organisationId,
        userId: input.userId,
        entityType: 'document',
        entityId: document.id,
        action: 'document.delete',
        metadata: { cascadedFrom: matter.id },
        requestId: input.requestId,
      })
    }
    for (const run of runs) {
      await appendAuditLog(client, {
        organisationId: input.organisationId,
        userId: input.userId,
        entityType: 'redaction_run',
        entityId: run.id,
        action: 'redaction_run.delete',
        metadata: { cascadedFrom: matter.id },
        requestId: input.requestId,
      })
    }

    await client.query('commit')
    return { matter, documents, runs }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

/**
 * Cascade-restore symmetric with softDeleteMatterWithCascade. Reads the matter's
 * `deleted_at` (= T) under FOR UPDATE, then restores only children whose
 * `deleted_at = T` — the ones this matter's deletion took down. An
 * individually-deleted child (timestamp ≠ T) stays deleted.
 */
export async function restoreMatterWithAudit(
  pool: Pool,
  input: RestoreMatterInput,
): Promise<MatterRecord | null> {
  const client = await pool.connect()

  try {
    await client.query('begin')

    // The deleted-matter form locks the soft-deleted row, re-checks edit
    // access on a fresh snapshot, and returns the cascade timestamp as text:
    // the pg driver returns timestamptz as a JS Date at millisecond precision,
    // and round-tripping that through a param would drop microseconds and
    // break the equality match against the children this deletion took down.
    const cascadeTimestamp = await lockDeletedMatterForEdit(client, {
      organisationId: input.organisationId,
      matterId: input.id,
      userId: input.userId,
    })
    if (cascadeTimestamp === null) {
      await client.query('rollback')
      return null
    }

    const matterResult = await client.query<MatterRow>(
      `
        update matters
        set status = 'active', deleted_at = null, deleted_by = null, updated_at = now()
        where id = $1 and organisation_id = $2 and deleted_at = $3::timestamptz
        returning ${matterColumns}
      `,
      [input.id, input.organisationId, cascadeTimestamp],
    )
    const matter = firstOrNull(matterResult, mapMatter)
    if (!matter) {
      await client.query('rollback')
      return null
    }

    const documentsResult = await client.query<MatterDocumentRow>(
      `
        update matter_documents
        set deleted_at = null, deleted_by = null, updated_at = now()
        where matter_id = $1 and organisation_id = $2 and deleted_at = $3::timestamptz
        returning ${documentColumns}
      `,
      [input.id, input.organisationId, cascadeTimestamp],
    )
    const documents = documentsResult.rows.map(mapDocument)

    const runsResult = await client.query<{ id: string }>(
      `
        update redaction_runs
        set deleted_at = null, deleted_by = null, updated_at = now()
        where matter_id = $1
          and organisation_id = $2
          and deleted_at = $3::timestamptz
          and (
            document_id is null
            or exists (
              select 1
              from matter_documents document
              where document.id = redaction_runs.document_id
                and document.matter_id = redaction_runs.matter_id
                and document.organisation_id = redaction_runs.organisation_id
                and document.deleted_at is null
            )
          )
        returning id
      `,
      [input.id, input.organisationId, cascadeTimestamp],
    )
    const runs = runsResult.rows

    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.userId,
      entityType: 'matter',
      entityId: matter.id,
      action: 'matter.restore',
      metadata: {
        documentCount: documents.length,
        runCount: runs.length,
      },
      requestId: input.requestId,
    })
    for (const document of documents) {
      await appendAuditLog(client, {
        organisationId: input.organisationId,
        userId: input.userId,
        entityType: 'document',
        entityId: document.id,
        action: 'document.restore',
        metadata: { cascadedFrom: matter.id },
        requestId: input.requestId,
      })
    }
    for (const run of runs) {
      await appendAuditLog(client, {
        organisationId: input.organisationId,
        userId: input.userId,
        entityType: 'redaction_run',
        entityId: run.id,
        action: 'redaction_run.restore',
        metadata: { cascadedFrom: matter.id },
        requestId: input.requestId,
      })
    }

    await client.query('commit')
    return matter
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export { appendAuditLog } from './audit-log'
export {
  createDocumentInTransaction,
  createDocumentObjectKey,
  updateDocumentExtraction,
} from './document-database'
