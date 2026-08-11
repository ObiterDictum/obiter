import { describe, expect, it } from 'vitest'

import {
  createComment,
  resolveComment,
  routeApp,
  TestDatabase,
} from './comments.test-support'

describe('document comment routes', () => {
  it.each([
    ['GET', '/api/documents/doc_1/comments'],
    ['POST', '/api/documents/doc_1/comments'],
    ['PATCH', '/api/documents/doc_1/comments/cmt_1/resolve'],
  ])(
    'rejects unauthenticated %s access before document or comment queries',
    async (method, path) => {
      const database = new TestDatabase()
      const response = await routeApp(database, null).app.request(path, {
        method,
      })

      expect(response.status).toBe(401)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(database.queries).toEqual([])
    },
  )

  it('provisions an organisation for an org-less user', async () => {
    const database = new TestDatabase({ access: 'owner' })
    const response = await routeApp(database, {
      id: 'usr_actor',
      name: 'Case Reviewer',
      organisationId: null,
      role: null,
    }).app.request('/api/documents/doc_1/comments')

    expect(response.status).toBe(200)
    expect(database.transactionCommands).toEqual(['begin', 'commit'])
  })

  it.each([
    ['unknown', 'doc_unknown'],
    ['cross-organisation', 'doc_cross'],
    ['soft-deleted', 'doc_deleted'],
  ])(
    'returns the uniform document 404 for a %s document',
    async (_name, id) => {
      const database = new TestDatabase()
      const response = await routeApp(database).app.request(
        `/api/documents/${id}/comments`,
      )

      await expectDocument404(response)
      expect(
        database.queries.some(({ sql }) => sql.includes('document_comments')),
      ).toBe(false)
    },
  )

  it.each([
    ['a non-ready version', { status: 'processing' as const }],
    ['a non-DOCX version', { fileType: 'pdf' }],
  ])('returns the uniform document 404 for %s', async (_name, options) => {
    const response = await routeApp(new TestDatabase(options)).app.request(
      '/api/documents/doc_1/comments',
    )
    await expectDocument404(response)
  })

  it('allows a view grantee to list but not create or resolve', async () => {
    const database = new TestDatabase({ access: 'view' })
    const existing = database.seedComment()
    const app = routeApp(database).app

    const listed = await app.request('/api/documents/doc_1/comments')
    const created = await createComment(app, {
      body: 'Not permitted',
      anchor: { paragraphId: 'para-1', startOffset: 0, endOffset: 1 },
    })
    const resolved = await resolveComment(app, existing.id)

    expect(listed.status).toBe(200)
    expect(listed.headers.get('cache-control')).toBe('no-store')
    await expect(listed.json()).resolves.toMatchObject({
      comments: [{ id: existing.id, body: existing.body }],
    })
    await expectDocument404(created)
    await expectDocument404(resolved)
    expect(database.comments.get(existing.id)?.resolvedAt).toBeNull()
    expect(database.audits).toEqual([])
  })

  it('creates and resolves transactionally for an edit grantee with body-free audits', async () => {
    const database = new TestDatabase({ access: 'edit' })
    const app = routeApp(database).app
    const privateBody = 'Synthetic confidential review note'

    const created = await createComment(app, {
      body: privateBody,
      anchor: { paragraphId: 'para-1', startOffset: 1, endOffset: 4 },
    })
    expect(created.status).toBe(201)
    expect(created.headers.get('cache-control')).toBe('no-store')
    const createdBody = (await created.json()) as { comment: { id: string } }

    const resolved = await resolveComment(app, createdBody.comment.id)
    expect(resolved.status).toBe(200)
    expect(resolved.headers.get('cache-control')).toBe('no-store')
    await expect(resolved.json()).resolves.toMatchObject({
      comment: {
        id: createdBody.comment.id,
        resolvedBy: 'usr_actor',
        resolvedAt: '2026-08-10T14:00:00.000Z',
      },
    })

    expect(database.audits.map(({ action }) => action)).toEqual([
      'document.comment_create',
      'document.comment_resolve',
    ])
    expect(
      database.audits.every(
        ({ entityType }) => entityType === 'document_comment',
      ),
    ).toBe(true)
    expect(JSON.stringify(database.audits)).not.toContain(privateBody)
    expect(database.transactionCommands).toEqual([
      'begin',
      'commit',
      'begin',
      'commit',
    ])
  })

  it('rechecks the active ready document inside the mutation transaction', async () => {
    const database = new TestDatabase({
      access: 'edit',
      transactionDocumentMissing: true,
    })

    const response = await createComment(routeApp(database).app, {
      body: 'Race-safe review',
      anchor: { paragraphId: 'para-1', startOffset: 0, endOffset: 0 },
    })

    await expectDocument404(response)
    expect(database.comments.size).toBe(0)
    expect(database.audits).toEqual([])
    expect(database.transactionCommands).toEqual(['begin', 'rollback'])
    expect(
      database.queries.some(
        ({ sql }) =>
          sql.includes('join document_versions version') &&
          sql.includes('for update of document'),
      ),
    ).toBe(true)
  })

  it('keeps repeated resolution idempotent while auditing each request', async () => {
    const database = new TestDatabase({ access: 'edit' })
    const existing = database.seedComment()
    const app = routeApp(database).app

    const first = await resolveComment(app, existing.id)
    const second = await resolveComment(app, existing.id)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(database.comments.get(existing.id)).toMatchObject({
      resolvedAt: '2026-08-10T14:00:00.000Z',
      updatedAt: '2026-08-10T14:00:00.000Z',
    })
    expect(database.audits.map(({ action }) => action)).toEqual([
      'document.comment_resolve',
      'document.comment_resolve',
    ])
  })

  it.each([
    [
      'blank body',
      {
        body: '  ',
        anchor: { paragraphId: 'para-1', startOffset: 0, endOffset: 0 },
      },
    ],
    [
      'overlong body',
      {
        body: 'x'.repeat(10_001),
        anchor: { paragraphId: 'para-1', startOffset: 0, endOffset: 0 },
      },
    ],
    [
      'an unsupported XML control character',
      {
        body: 'Review\u0000text',
        anchor: { paragraphId: 'para-1', startOffset: 0, endOffset: 0 },
      },
    ],
    [
      'negative offset',
      {
        body: 'Review',
        anchor: { paragraphId: 'para-1', startOffset: -1, endOffset: 0 },
      },
    ],
    [
      'reversed range',
      {
        body: 'Review',
        anchor: { paragraphId: 'para-1', startOffset: 2, endOffset: 1 },
      },
    ],
    [
      'client-supplied authorship',
      {
        body: 'Review',
        anchor: { paragraphId: 'para-1', startOffset: 0, endOffset: 0 },
        author: { id: 'usr_other', name: 'Other user' },
      },
    ],
  ])('rejects a create request with %s', async (_name, body) => {
    const database = new TestDatabase({ access: 'edit' })
    const response = await createComment(routeApp(database).app, body)

    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(database.comments.size).toBe(0)
    expect(database.audits).toEqual([])
  })

  it('validates the empty resolve request and hides a missing comment behind document 404', async () => {
    const database = new TestDatabase({ access: 'edit' })
    const app = routeApp(database).app

    const invalid = await resolveComment(app, 'cmt_missing', {
      unresolve: true,
    })
    const missing = await resolveComment(app, 'cmt_missing')

    expect(invalid.status).toBe(400)
    await expectDocument404(missing)
    expect(database.audits).toEqual([])
  })

  it('rolls back comment creation when its audit insert fails', async () => {
    const privateBody = 'Synthetic rollback marker'
    const database = new TestDatabase({ access: 'edit', auditFailure: true })
    const { app, errors } = routeApp(database)

    const response = await createComment(app, {
      body: privateBody,
      anchor: { paragraphId: 'para-1', startOffset: 0, endOffset: 0 },
    })

    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(database.comments.size).toBe(0)
    expect(database.audits).toEqual([])
    expect(database.transactionCommands).toEqual(['begin', 'rollback'])
    expect(errors).toEqual(['The comment operation could not be completed.'])
    expect(JSON.stringify(errors)).not.toContain(privateBody)
  })

  it('rolls back comment resolution when its audit insert fails', async () => {
    const database = new TestDatabase({ access: 'edit', auditFailure: true })
    const existing = database.seedComment()

    const response = await resolveComment(routeApp(database).app, existing.id)

    expect(response.status).toBe(500)
    expect(database.comments.get(existing.id)?.resolvedAt).toBeNull()
    expect(database.audits).toEqual([])
    expect(database.transactionCommands).toEqual(['begin', 'rollback'])
  })
})

async function expectDocument404(response: Response) {
  expect(response.status).toBe(404)
  expect(response.headers.get('cache-control')).toBe('no-store')
  await expect(response.json()).resolves.toMatchObject({
    error: { code: 'document_not_found' },
  })
}
