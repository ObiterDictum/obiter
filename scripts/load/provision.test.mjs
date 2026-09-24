import { describe, expect, it } from 'bun:test'
import {
  ProvisionError,
  documentRowsSql,
  fixtureIds,
  provisionFixtures,
  provisionSql,
  softDeleteFixtures,
  sqlLiteral,
  verifyIsolation,
  verifyRun,
} from './provision.mjs'

describe('sqlLiteral', () => {
  it('quotes and escapes so a value cannot end the literal', () => {
    expect(sqlLiteral("O'Brien")).toBe("'O''Brien'")
    expect(sqlLiteral('plain')).toBe("'plain'")
  })

  it('renders absent values as null rather than an empty string', () => {
    expect(sqlLiteral(null)).toBe('null')
    expect(sqlLiteral(undefined)).toBe('null')
  })
})

describe('fixtureIds', () => {
  it('names every row with the run tag so leftovers are identifiable', () => {
    const ids = fixtureIds('abc12345')
    expect(ids.organisationId).toBe('org_q3load_abc12345')
    expect(ids.otherOrganisationId).toBe('org_q3load_abc12345b')
    expect(ids.otherMatterId).toBe('mtr_q3load_abc12345b')
  })

  it('issues session tokens with no separator character', () => {
    const ids = fixtureIds('abc12345')
    expect(ids.sessionToken).toMatch(/^[a-zA-Z0-9]+$/)
    expect(ids.otherSessionToken).toMatch(/^[a-zA-Z0-9]+$/)
    expect(ids.sessionToken).not.toBe(ids.otherSessionToken)
  })

  it('refuses a tag that is not safe to build SQL from', () => {
    expect(() => fixtureIds("abc'; drop table users; --")).toThrow(
      ProvisionError,
    )
  })
})

describe('provisionSql', () => {
  it('creates both tenants, both sessions and the refused matter', () => {
    const sql = provisionSql(fixtureIds('abc12345'))
    expect(sql).toContain('insert into organisations')
    expect(sql).toContain('org_q3load_abc12345')
    expect(sql).toContain('org_q3load_abc12345b')
    expect(sql).toContain('ses_q3load_abc12345b')
    expect(sql).toContain('mtr_q3load_abc12345b')
    expect(sql.trim().startsWith('begin;')).toBe(true)
    expect(sql.trim().endsWith('commit;')).toBe(true)
  })

  it('carries no placeholder that could be substituted after validation', () => {
    const sql = provisionSql(fixtureIds('abc12345'))
    expect(sql).not.toMatch(/\$\{/)
  })
})

describe('verifyRun', () => {
  const ids = fixtureIds('abc12345')
  const querier = {
    rows(sql) {
      if (sql === documentRowsSql(ids.matterId))
        return [
          { document_id: 'doc_1', current_version_id: 'ver_1' },
          { document_id: 'doc_2', current_version_id: 'ver_2' },
        ]
      if (sql.includes('document_versions'))
        return [
          {
            version_id: 'ver_1',
            document_id: 'doc_1',
            version_number: 1,
            document_status: 'ready',
            content_sha256: 'a'.repeat(64),
            object_key: 'org/o/matters/m/documents/doc_1/versions/ver_1/source',
            text_object_key:
              'org/o/matters/m/documents/doc_1/versions/ver_1/text',
            failure_reason: null,
          },
          {
            version_id: 'ver_2',
            document_id: 'doc_2',
            version_number: 1,
            document_status: 'ready',
            content_sha256: 'b'.repeat(64),
            object_key: 'org/o/matters/m/documents/doc_2/versions/ver_2/source',
            text_object_key:
              'org/o/matters/m/documents/doc_2/versions/ver_2/text',
            failure_reason: null,
          },
        ]
      return [
        { action: 'document.upload', count: 2 },
        { action: 'document.version_create', count: 2 },
        { action: 'matter.create', count: 1 },
      ]
    },
  }

  it('reports counts, storage presence and audit rows for a clean run', async () => {
    const verification = await verifyRun({
      querier,
      ids,
      storageRoot: '/work/lane-security/services/api/.obiter-storage',
      expectedReady: 2,
      statFile: async () => ({ size: 1 }),
    })
    expect(verification.documentCount).toBe(2)
    expect(verification.readyCount).toBe(2)
    expect(verification.readyMatchesExpected).toBe(true)
    expect(verification.allStoragePresent).toBe(true)
    expect(verification.documentsWithoutVersion).toBe(0)
    expect(verification.duplicateDocumentIds).toEqual([])
    expect(verification.versionCountMatchesDocuments).toBe(true)
    expect(verification.auditMatchesExpected).toBe(true)
    expect(verification.audit).toEqual([
      { action: 'document.upload', count: 2 },
      { action: 'document.version_create', count: 2 },
      { action: 'matter.create', count: 1 },
    ])
    expect(verification.storageRoot).toBe(
      '/work/lane-security/services/api/.obiter-storage',
    )
  })

  it('fails the audit assertion when the expected rows are missing', async () => {
    const shortAudit = {
      rows: (sql) =>
        sql.includes('audit_logs')
          ? [{ action: 'document.upload', count: 1 }]
          : querier.rows(sql),
    }
    const verification = await verifyRun({
      querier: shortAudit,
      ids,
      storageRoot: '/work/lane-security/services/api/.obiter-storage',
      expectedReady: 2,
      statFile: async () => ({ size: 1 }),
    })
    expect(verification.auditMatchesExpected).toBe(false)
    expect(verification.auditExpected).toEqual({
      'document.upload': 2,
      'document.version_create': 2,
      'matter.create': 1,
    })
  })

  it('passes the audit assertion only for the exact expected shape', async () => {
    const exactAudit = {
      rows: (sql) =>
        sql.includes('audit_logs')
          ? [
              { action: 'document.upload', count: 2 },
              { action: 'document.version_create', count: 2 },
              { action: 'matter.create', count: 1 },
            ]
          : querier.rows(sql),
    }
    const verification = await verifyRun({
      querier: exactAudit,
      ids,
      storageRoot: '/work/lane-security/services/api/.obiter-storage',
      expectedReady: 2,
      statFile: async () => ({ size: 1 }),
    })
    expect(verification.auditMatchesExpected).toBe(true)
  })

  it('fails the storage check when an object is missing', async () => {
    const verification = await verifyRun({
      querier,
      ids,
      storageRoot: '/work/lane-security/services/api/.obiter-storage',
      expectedReady: 2,
      statFile: async (path) => {
        if (String(path).endsWith('/ver_2/text')) throw new Error('ENOENT')
        return { size: 1 }
      },
    })
    expect(verification.allStoragePresent).toBe(false)
  })

  it('flags a document with no version row', async () => {
    const partial = {
      rows: (sql) =>
        sql === documentRowsSql(ids.matterId)
          ? [{ document_id: 'doc_1' }, { document_id: 'doc_orphan' }]
          : querier.rows(sql),
    }
    const verification = await verifyRun({
      querier: partial,
      ids,
      storageRoot: '/work/lane-security/services/api/.obiter-storage',
      expectedReady: 2,
      statFile: async () => ({ size: 1 }),
    })
    expect(verification.documentsWithoutVersion).toBe(1)
  })

  it('detects a duplicated version number inside one document', async () => {
    const duplicated = {
      rows: (sql) => {
        if (sql === documentRowsSql(ids.matterId))
          return [{ document_id: 'doc_1' }]
        if (sql.includes('document_versions'))
          return [
            {
              version_id: 'ver_1',
              document_id: 'doc_1',
              version_number: 1,
              document_status: 'ready',
              object_key: 'a',
              text_object_key: 'b',
            },
            {
              version_id: 'ver_2',
              document_id: 'doc_1',
              version_number: 1,
              document_status: 'ready',
              object_key: 'c',
              text_object_key: 'd',
            },
          ]
        return []
      },
    }
    const verification = await verifyRun({
      querier: duplicated,
      ids,
      storageRoot: '/work/lane-security/services/api/.obiter-storage',
      expectedReady: 2,
      statFile: async () => ({ size: 1 }),
    })
    expect(verification.duplicateVersionNumbers).toEqual(['doc_1#1'])
    expect(verification.versionCountMatchesDocuments).toBe(false)
  })
})

describe('verifyIsolation', () => {
  const ids = fixtureIds('abc12345')
  const target = { apiOrigin: 'http://localhost:8791' }

  function fetchImpl(handler) {
    return async (url, init) => {
      const status = handler(url, init)
      return {
        status,
        text: async () => (status === 404 ? '' : 'body'),
        json: async () => ({ matters: [{ id: ids.matterId ?? 'mtr_own' }] }),
      }
    }
  }

  it('passes when another tenant’s matter and the unauthenticated paths are refused', async () => {
    const result = await verifyIsolation({
      target,
      ids,
      fetchImpl: fetchImpl((url, init) => {
        if (url.endsWith('/api/matters') && init.headers.Authorization)
          return 200
        if (!init.headers.Authorization) return 401
        return 404
      }),
    })
    expect(result.allPassed).toBe(true)
  })

  it('fails when another tenant’s matter is readable', async () => {
    const result = await verifyIsolation({
      target,
      ids,
      fetchImpl: fetchImpl((url, init) => {
        if (url.endsWith('/api/matters') && init.headers.Authorization)
          return 200
        if (!init.headers.Authorization) return 401
        return url.includes(ids.otherMatterId) ? 200 : 404
      }),
    })
    expect(result.allPassed).toBe(false)
    expect(
      result.checks.find((check) => check.name === 'other_matter_read').passed,
    ).toBe(false)
  })

  it('fails when a denial echoes the other tenant’s matter name', async () => {
    const result = await verifyIsolation({
      target,
      ids,
      fetchImpl: async (url, init) => ({
        status: url.includes(ids.otherMatterId)
          ? 404
          : init.headers?.Authorization
            ? 200
            : 401,
        text: async () =>
          url.includes(ids.otherMatterId) ? ids.otherMatterName : '{}',
        json: async () => ({ matters: [] }),
      }),
    })
    expect(result.allPassed).toBe(false)
    expect(
      result.checks.find((check) => check.name === 'other_matter_read')
        .leakedOtherName,
    ).toBe(true)
  })
})

describe('provisionFixtures', () => {
  const target = { apiOrigin: 'http://localhost:8791' }
  const ids = fixtureIds('abc12345')

  function querier() {
    const executed = []
    return { executed, exec: (sql) => executed.push(sql), rows: () => [] }
  }

  function fetchImpl({ me = 200, meBody = null, matter = 201 } = {}) {
    return async (url) => {
      if (url.endsWith('/api/matters'))
        return {
          status: matter,
          json: async () => ({
            matter: { id: 'mtr_created', name: ids.matterName },
          }),
        }
      return {
        status: me,
        json: async () =>
          meBody ?? {
            user: { id: ids.userId },
            organisation: { id: ids.organisationId },
          },
      }
    }
  }

  /** Records the order the API saw, so "prove before create" is asserted. */
  function recordingFetchImpl(options = {}) {
    const calls = []
    const inner = fetchImpl(options)
    return {
      calls,
      impl: async (url, init) => {
        calls.push(url.endsWith('/api/me') ? 'me' : 'matter')
        return inner(url, init)
      },
    }
  }

  it('writes the fixtures, proves the session, then creates the matter', async () => {
    const q = querier()
    const { calls, impl } = recordingFetchImpl()
    let sqlNotified = 0
    const provisioned = await provisionFixtures({
      target,
      querier: q,
      fetchImpl: impl,
      ids,
      onSqlWritten: () => {
        sqlNotified += 1
      },
    })
    expect(q.executed).toHaveLength(1)
    expect(sqlNotified).toBe(1)
    // A matter that was never created is a matter that never needs cleaning up.
    expect(calls).toEqual(['me', 'matter'])
    expect(provisioned.matterId).toBe('mtr_created')
    expect(provisioned.sessionToken).toBe(ids.sessionToken)
  })

  it('refuses a rejected session before creating a matter', async () => {
    const { calls, impl } = recordingFetchImpl({ me: 401 })
    await expect(
      provisionFixtures({ target, querier: querier(), fetchImpl: impl, ids }),
    ).rejects.toThrow(/rejected/)
    expect(calls).toEqual(['me'])
  })

  it('refuses when the API answers /api/me for a different tenant', async () => {
    await expect(
      provisionFixtures({
        target,
        querier: querier(),
        fetchImpl: fetchImpl({
          meBody: {
            user: { id: 'usr_other' },
            organisation: { id: 'org_other' },
          },
        }),
        ids,
      }),
    ).rejects.toThrow(/different user or organisation/)
  })

  it('refuses when the fixture matter cannot be created', async () => {
    await expect(
      provisionFixtures({
        target,
        querier: querier(),
        fetchImpl: fetchImpl({ matter: 400 }),
        ids,
      }),
    ).rejects.toThrow(/cannot start/)
  })
})

describe('softDeleteFixtures', () => {
  it('uses the normal delete route for each matter with its own session', async () => {
    const calls = []
    const deleted = await softDeleteFixtures({
      target: { apiOrigin: 'http://localhost:8791' },
      ids: { ...fixtureIds('abc12345'), matterId: 'mtr_created' },
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          method: init.method,
          authorization: init.headers.Authorization,
        })
        return { status: 200, json: async () => ({}) }
      },
    })
    expect(calls).toHaveLength(2)
    expect(calls.every((call) => call.method === 'DELETE')).toBe(true)
    expect(new Set(calls.map((call) => call.authorization)).size).toBe(2)
    expect(deleted.every((entry) => entry.status === 200)).toBe(true)
  })
})
