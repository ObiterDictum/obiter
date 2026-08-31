import { Hono } from 'hono'
import type { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import type { AuthzVariables } from '../authz'
import type { RedactionRunRow } from '../redaction-database'
import { createDocumentAccessRoutes } from './document-access'
import { createDocumentsRoutes } from './documents'
import { createMattersRoutes } from './matters'
import { createRedactLifecycleRoutes } from './redact-lifecycle'
import { createRedactReviewRoutes } from './redact-review'

const created = '2026-08-01T00:00:00.000Z'

function matterRow(id: string, organisationId: string, ownerUserId: string) {
  return {
    id,
    organisation_id: organisationId,
    name: `${id} matter`,
    description: null,
    primary_jurisdiction: 'england_and_wales',
    secondary_jurisdictions: [],
    legal_domains: [],
    client_reference: '',
    status: 'active' as const,
    created_by: ownerUserId,
    created_at: created,
    updated_at: created,
    deleted_at: null,
    deleted_by: null,
  }
}

function documentRow(
  id: string,
  organisationId: string,
  matterId: string,
  ownerUserId: string,
) {
  return {
    id,
    organisation_id: organisationId,
    matter_id: matterId,
    current_version_id: `ver_${id}`,
    logical_key: `key_${id}`,
    created_by: ownerUserId,
    created_at: created,
    updated_at: created,
    deleted_at: null,
    deleted_by: null,
  }
}

function versionRow(
  documentId: string,
  organisationId: string,
  matterId: string,
  ownerUserId: string,
) {
  return {
    id: `ver_${documentId}`,
    organisation_id: organisationId,
    matter_id: matterId,
    matter_document_id: documentId,
    filename: `${documentId}.txt`,
    file_type: 'txt',
    size_bytes: '12',
    object_key: `org/${organisationId}/documents/${documentId}/source`,
    text_object_key: `org/${organisationId}/documents/${documentId}/text`,
    document_status: 'ready',
    failure_reason: null,
    version_number: 1,
    content_sha256: 'abc',
    sync_state: 'synced',
    created_by: ownerUserId,
    created_at: created,
    updated_at: created,
  }
}

function runRow(
  id: string,
  organisationId: string,
  matterId: string,
  documentId: string,
  ownerUserId: string,
): RedactionRunRow {
  return {
    id,
    organisation_id: organisationId,
    matter_id: matterId,
    matter_name: `${matterId} matter`,
    document_id: documentId,
    document_version_id: `ver_${documentId}`,
    source_filename: `${documentId}.txt`,
    source_text_object_key: `org/${organisationId}/documents/${documentId}/text`,
    source_file_object_key: null,
    source_layout_object_key: null,
    source_mime_type: 'text/plain',
    status: 'finalized',
    policy_mode: 'internal_ai_minimisation',
    spans_json: [],
    decisions_json: {},
    output_artifact_id: null,
    summary_json: {},
    detector_version: 'detector-1',
    detection_mode: 'model+supplement',
    replaces_run_id: null,
    replacement_run_id: null,
    created_by: ownerUserId,
    created_at: created,
    updated_at: created,
    deleted_at: null,
    deleted_by: null,
  }
}

function shareRow(
  organisationId: string,
  matterId: string,
  ownerUserId: string,
) {
  return {
    id: `shr_${matterId}`,
    organisation_id: organisationId,
    matter_id: matterId,
    grantee_user_id: 'usr_grantee',
    access_level: 'view',
    created_by: ownerUserId,
    created_at: created,
  }
}

const tenantA = {
  organisationId: 'org_a',
  userId: 'usr_a',
  matterId: 'mtr_a',
  documentId: 'doc_a',
  runId: 'red_a',
}
const tenantB = {
  organisationId: 'org_b',
  userId: 'usr_b',
  matterId: 'mtr_b',
  documentId: 'doc_b',
  runId: 'red_b',
}

const matters = [
  matterRow(tenantA.matterId, tenantA.organisationId, tenantA.userId),
  matterRow(tenantB.matterId, tenantB.organisationId, tenantB.userId),
]
const documents = [
  documentRow(
    tenantA.documentId,
    tenantA.organisationId,
    tenantA.matterId,
    tenantA.userId,
  ),
  documentRow(
    tenantB.documentId,
    tenantB.organisationId,
    tenantB.matterId,
    tenantB.userId,
  ),
]
const versions = [
  versionRow(
    tenantA.documentId,
    tenantA.organisationId,
    tenantA.matterId,
    tenantA.userId,
  ),
  versionRow(
    tenantB.documentId,
    tenantB.organisationId,
    tenantB.matterId,
    tenantB.userId,
  ),
]
const runs = [
  runRow(
    tenantA.runId,
    tenantA.organisationId,
    tenantA.matterId,
    tenantA.documentId,
    tenantA.userId,
  ),
  runRow(
    tenantB.runId,
    tenantB.organisationId,
    tenantB.matterId,
    tenantB.documentId,
    tenantB.userId,
  ),
]
const shares = [
  shareRow(tenantA.organisationId, tenantA.matterId, tenantA.userId),
  shareRow(tenantB.organisationId, tenantB.matterId, tenantB.userId),
]
const audits = [
  {
    action: 'redaction.finalize',
    user_id: tenantA.userId,
    created_at: created,
    metadata_json: {},
    organisation_id: tenantA.organisationId,
    entity_id: tenantA.runId,
  },
  {
    action: 'redaction.finalize',
    user_id: tenantB.userId,
    created_at: created,
    metadata_json: {},
    organisation_id: tenantB.organisationId,
    entity_id: tenantB.runId,
  },
]

function scoped<T extends { organisation_id: string }>(
  rows: T[],
  organisationId: unknown,
  extra: (row: T) => boolean = () => true,
) {
  return rows.filter(
    (row) => row.organisation_id === organisationId && extra(row),
  )
}

const query = async (sql: string, parameters: unknown[] = []) => {
  const text = sql.replace(/\s+/gu, ' ')
  if (text.includes('from audit_logs')) {
    return {
      rows: audits.filter(
        (row) =>
          row.organisation_id === parameters[0] &&
          row.entity_id === parameters[1],
      ),
    }
  }
  if (text.includes('from redaction_runs')) {
    if (text.includes('run.id = $1') || text.includes('where id = $1')) {
      return {
        rows: scoped(runs, parameters[1], (row) => row.id === parameters[0]),
      }
    }
    return { rows: scoped(runs, parameters[0]) }
  }
  if (
    text.includes('from matters matter') &&
    text.includes('where matter.id')
  ) {
    return {
      rows: scoped(matters, parameters[1], (row) => row.id === parameters[0]),
    }
  }
  if (text.includes('select matter_id from matter_documents')) {
    return {
      rows: scoped(
        documents,
        parameters[1],
        (row) => row.id === parameters[0],
      ).map((row) => ({ matter_id: row.matter_id })),
    }
  }
  if (text.includes('from matter_documents document')) {
    return {
      rows: scoped(documents, parameters[1], (row) => row.id === parameters[0]),
    }
  }
  if (text.includes('from document_versions')) {
    return {
      rows: scoped(
        versions,
        parameters[0],
        (row) =>
          row.matter_document_id === parameters[1] || row.id === parameters[1],
      ),
    }
  }
  if (text.includes('from matter_shares')) {
    return {
      rows: scoped(
        shares,
        parameters[0],
        (row) => row.matter_id === parameters[1],
      ),
    }
  }
  if (
    text.startsWith('update ') ||
    text.startsWith('insert ') ||
    text === 'begin' ||
    text === 'commit' ||
    text === 'rollback'
  ) {
    return { rows: [] }
  }
  return { rows: [] }
}

const pool = {
  query,
  connect: async () => ({ query, release: () => undefined }),
} as unknown as Pool

function app(userId: string, organisationId: string) {
  const routes = new Hono<{ Variables: AuthzVariables }>()
  routes.use('*', async (context, next) => {
    context.set('requestId', 'req_isolation')
    context.set('user', {
      id: userId,
      organisationId,
      role: 'owner',
    })
    await next()
  })
  routes.route('/', createMattersRoutes(pool))
  routes.route('/', createDocumentAccessRoutes(pool))
  routes.route('/', createDocumentsRoutes(pool))
  routes.route(
    '/',
    createRedactReviewRoutes(pool, {
      readText: async () => {
        throw new Error('isolation tests must not read storage')
      },
      writeText: async () => undefined,
      readBinary: async () => {
        throw new Error('isolation tests must not read storage')
      },
      writeBinary: async () => undefined,
      delete: async () => undefined,
    }),
  )
  routes.route(
    '/',
    createRedactLifecycleRoutes(pool, {
      readText: async () => {
        throw new Error('isolation tests must not read storage')
      },
      writeText: async () => undefined,
      readBinary: async () => {
        throw new Error('isolation tests must not read storage')
      },
      writeBinary: async () => undefined,
      delete: async () => undefined,
    }),
  )
  return routes
}

const json = (body: unknown, method: 'POST' | 'PATCH' = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('organisation isolation (V10)', () => {
  it('hides the other organisation matters, shares, documents, versions, runs and audit logs', async () => {
    const userA = app(tenantA.userId, tenantA.organisationId)
    const userB = app(tenantB.userId, tenantB.organisationId)

    const ownMatter = await userA.request(`/api/matters/${tenantA.matterId}`)
    expect(ownMatter.status).toBe(200)

    const foreignMatter = await userA.request(
      `/api/matters/${tenantB.matterId}`,
    )
    expect(foreignMatter.status).toBe(404)
    const foreignMatterMutate = await userA.request(
      `/api/matters/${tenantB.matterId}`,
      json({ name: 'taken' }, 'PATCH'),
    )
    expect(foreignMatterMutate.status).toBe(404)
    const foreignMatterDelete = await userA.request(
      `/api/matters/${tenantB.matterId}`,
      { method: 'DELETE' },
    )
    expect(foreignMatterDelete.status).toBe(404)

    const foreignShares = await userA.request(
      `/api/matters/${tenantB.matterId}/shares`,
    )
    expect(foreignShares.status).toBe(404)
    const foreignShareCreate = await userA.request(
      `/api/matters/${tenantB.matterId}/shares`,
      json({ granteeUserId: 'usr_a', accessLevel: 'view' }),
    )
    expect(foreignShareCreate.status).toBe(404)

    const ownDocuments = await userA.request(
      `/api/matters/${tenantA.matterId}/documents`,
    )
    expect(ownDocuments.status).toBe(200)
    const foreignDocuments = await userA.request(
      `/api/matters/${tenantB.matterId}/documents`,
    )
    expect(foreignDocuments.status).toBe(404)

    const ownDocument = await userA.request(
      `/api/documents/${tenantA.documentId}`,
    )
    expect(ownDocument.status).toBe(200)
    const ownVersions = (await ownDocument.json()) as {
      versions: { id: string }[]
    }
    expect(ownVersions.versions.map((version) => version.id)).toEqual([
      `ver_${tenantA.documentId}`,
    ])
    const foreignDocument = await userA.request(
      `/api/documents/${tenantB.documentId}`,
    )
    expect(foreignDocument.status).toBe(404)
    const foreignDocumentDelete = await userA.request(
      `/api/documents/${tenantB.documentId}`,
      { method: 'DELETE' },
    )
    expect(foreignDocumentDelete.status).toBe(404)

    const ownRun = await userA.request(`/api/redaction-runs/${tenantA.runId}`)
    expect(ownRun.status).toBe(200)
    const foreignRun = await userA.request(
      `/api/redaction-runs/${tenantB.runId}`,
    )
    expect(foreignRun.status).toBe(404)
    const foreignRunDelete = await userA.request(
      `/api/redaction-runs/${tenantB.runId}`,
      { method: 'DELETE' },
    )
    expect(foreignRunDelete.status).toBe(404)

    const ownAudit = await userA.request(
      `/api/redaction-runs/${tenantA.runId}/audit`,
    )
    expect(ownAudit.status).toBe(200)
    const foreignAudit = await userA.request(
      `/api/redaction-runs/${tenantB.runId}/audit`,
    )
    expect(foreignAudit.status).toBe(404)

    const mirrorMatter = await userB.request(`/api/matters/${tenantA.matterId}`)
    expect(mirrorMatter.status).toBe(404)
    const mirrorDocument = await userB.request(
      `/api/documents/${tenantA.documentId}`,
    )
    expect(mirrorDocument.status).toBe(404)
    const mirrorRun = await userB.request(
      `/api/redaction-runs/${tenantA.runId}`,
    )
    expect(mirrorRun.status).toBe(404)
    const mirrorAudit = await userB.request(
      `/api/redaction-runs/${tenantA.runId}/audit`,
    )
    expect(mirrorAudit.status).toBe(404)
  })
})
