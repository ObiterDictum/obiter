import { describe, expect, it } from 'vitest'
import {
  getDocumentRedactionSource,
  listRedactionAuditLog,
} from './redaction-database'

describe('listRedactionAuditLog', () => {
  it('scopes run audit reads by organisation, excluding nullable auth audit rows', async () => {
    const queries: unknown[][] = []
    const pool = {
      query: async (...args: unknown[]) => {
        queries.push(args)
        return {
          rows: [
            {
              action: 'redaction.finalize',
              user_id: 'usr_1',
              created_at: '2026-01-01T00:00:00.000Z',
              metadata_json: {},
            },
          ],
        }
      },
    } as never
    await expect(
      listRedactionAuditLog(pool, 'org_1', 'red_1'),
    ).resolves.toEqual([
      {
        action: 'redaction.finalize',
        userId: 'usr_1',
        timestamp: '2026-01-01T00:00:00.000Z',
        details: {},
      },
    ])
    expect(String(queries[0][0])).toContain('organisation_id = $1')
    expect(queries[0][1]).toEqual(['org_1', 'red_1'])
  })
})

describe('getDocumentRedactionSource', () => {
  it('includes the organisation scope when resolving a document for a new run', async () => {
    const queries: unknown[][] = []
    const pool = {
      query: async (...args: unknown[]) => {
        queries.push(args)
        return { rows: [] }
      },
    } as never

    await expect(
      getDocumentRedactionSource(pool, 'org_1', 'doc_from_org_2'),
    ).resolves.toBeNull()

    expect(String(queries[0][0])).toContain('document.organisation_id = $2')
    expect(queries[0][1]).toEqual(['doc_from_org_2', 'org_1'])
  })
})
