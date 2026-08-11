import type { PoolClient } from 'pg'

type ExistingMergeRow = {
  base_version_id: string
  operations_sha256: string | null
  version_id: string
  version_number: number
}

export async function findExistingCollaborationMerge(
  client: PoolClient,
  input: {
    organisationId: string
    documentId: string
    userId: string
    syncId: string
  },
) {
  const result = await client.query<ExistingMergeRow>(
    `
      select
        audit.metadata_json ->> 'baseVersionId' as base_version_id,
        audit.metadata_json ->> 'operationsSha256' as operations_sha256,
        version.id as version_id,
        version.version_number
      from audit_logs audit
      join document_versions version
        on version.id = audit.metadata_json ->> 'newVersionId'
        and version.organisation_id = audit.organisation_id
        and version.matter_document_id = audit.entity_id
      where audit.organisation_id = $1
        and audit.entity_type = 'document'
        and audit.entity_id = $2
        and audit.user_id = $3
        and audit.action = 'document.collaboration_merge'
        and audit.metadata_json ->> 'syncId' = $4
        and audit.metadata_json ->> 'outcome' = 'merged'
      order by audit.created_at asc
      limit 1
    `,
    [input.organisationId, input.documentId, input.userId, input.syncId],
  )
  return result.rows[0] ?? null
}
