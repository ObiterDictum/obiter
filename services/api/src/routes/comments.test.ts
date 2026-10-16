import { parseModelJson, validateCommentAnchor } from '@obiter/ooxml'
import type { DocumentImportedComment } from '@obiter/contracts'
import { describe, expect, it } from 'bun:test'

import { importedCommentFingerprint } from '../imported-comment-fingerprint'

import {
  cachedCommentModelJson,
  cachedCommentModelJsonWith,
  createComment,
  expectDocument404,
  MemoryStorage,
  modelObjectKey,
  reopenComment,
  replyToComment,
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
    const database = new TestDatabase({ access: 'edit' })
    const response = await routeApp(database, {
      id: 'usr_actor',
      name: 'Case Reviewer',
      organisationId: null,
      role: null,
    }).app.request('/api/documents/doc_1/comments')

    expect(response.status).toBe(200)
    expect(database.transactionCommands.at(0)).toBe('begin')
    expect(database.transactionCommands.at(-1)).toBe('commit')
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
        database.queries.some((sql) => sql.includes('document_comments')),
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
        (sql) =>
          sql.includes('join document_versions version') &&
          sql.includes('for update of document'),
      ),
    ).toBe(true)
  })

  it('keeps repeated resolution idempotent and audits only the transition', async () => {
    const database = new TestDatabase({ access: 'edit' })
    const existing = database.seedComment({ authorId: 'usr_actor' })
    const app = routeApp(database).app

    const first = await resolveComment(app, existing.id)
    const second = await resolveComment(app, existing.id)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(database.comments.get(existing.id)).toMatchObject({
      resolvedAt: '2026-08-10T14:00:00.000Z',
      updatedAt: '2026-08-10T14:00:00.000Z',
    })
    // The second call already found the comment resolved: nothing changed,
    // so nothing is audited.
    expect(database.audits.map(({ action }) => action)).toEqual([
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
      'overlong paragraph id',
      {
        body: 'Review',
        anchor: {
          paragraphId: 'p'.repeat(256),
          startOffset: 0,
          endOffset: 0,
        },
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

  it.each([
    [
      'a missing paragraph',
      { paragraphId: 'para-missing', startOffset: 0, endOffset: 0 },
    ],
    [
      'an offset outside the paragraph text',
      { paragraphId: 'para-1', startOffset: 0, endOffset: 999 },
    ],
    [
      'an offset that splits a surrogate pair',
      { paragraphId: 'para-1', startOffset: 2, endOffset: 3 },
    ],
  ])('rejects %s before storing a comment', async (_name, anchor) => {
    const database = new TestDatabase({ access: 'edit' })
    const response = await createComment(routeApp(database).app, {
      body: 'Review',
      anchor,
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'comment_anchor_unresolved' },
    })
    expect(database.comments.size).toBe(0)
    expect(database.audits).toEqual([])
  })

  it('stores only an anchor that resolves against the pinned model', async () => {
    const database = new TestDatabase({ access: 'edit' })
    const { app, storage } = routeApp(database)
    const response = await createComment(app, {
      body: 'Resolvable review',
      anchor: { paragraphId: 'para-1', startOffset: 1, endOffset: 4 },
    })

    expect(response.status).toBe(201)
    const stored = [...database.comments.values()][0]
    if (!stored) throw new Error('Stored comment is missing.')
    expect(() =>
      validateCommentAnchor(parseModelJson(cachedCommentModelJson), {
        paragraphId: stored.paragraphId,
        startOffset: stored.startOffset,
        endOffset: stored.endOffset,
      }),
    ).not.toThrow()
    expect(storage.textReads).toEqual([modelObjectKey])
  })

  it('uses the user id when the session display name is empty', async () => {
    const database = new TestDatabase({ access: 'edit' })
    const response = await createComment(
      routeApp(database, {
        id: 'usr_actor',
        name: '',
        organisationId: 'org_1',
        role: 'member',
      }).app,
      {
        body: 'Fallback author review',
        anchor: { paragraphId: 'para-1', startOffset: 0, endOffset: 1 },
      },
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      comment: { author: { id: 'usr_actor', name: 'usr_actor' } },
    })
    expect([...database.comments.values()][0]?.authorName).toBe('usr_actor')
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
    const existing = database.seedComment({ authorId: 'usr_actor' })

    const response = await resolveComment(routeApp(database).app, existing.id)

    expect(response.status).toBe(500)
    expect(database.comments.get(existing.id)?.resolvedAt).toBeNull()
    expect(database.audits).toEqual([])
    expect(database.transactionCommands).toEqual(['begin', 'rollback'])
  })

  it('rejects resolution changes from a member who is not the author', async () => {
    const database = new TestDatabase({ access: 'edit' })
    const existing = database.seedComment({ authorId: 'usr_owner' })
    const app = routeApp(database).app

    const resolved = await resolveComment(app, existing.id)

    expect(resolved.status).toBe(403)
    await expect(resolved.json()).resolves.toMatchObject({
      error: { code: 'forbidden' },
    })
    expect(database.comments.get(existing.id)?.resolvedAt).toBeNull()
    expect(database.audits).toEqual([])
    expect(database.transactionCommands).toEqual(['begin', 'commit'])
  })

  it.each(['owner', 'admin'] as const)(
    "allows an organisation %s to resolve another member's comment",
    async (role) => {
      const database = new TestDatabase({ access: 'edit' })
      const existing = database.seedComment({ authorId: 'usr_owner' })
      const app = routeApp(database, {
        id: 'usr_actor',
        name: 'Case Reviewer',
        organisationId: 'org_1',
        role,
      }).app

      const resolved = await resolveComment(app, existing.id)

      expect(resolved.status).toBe(200)
      await expect(resolved.json()).resolves.toMatchObject({
        comment: {
          id: existing.id,
          resolvedBy: 'usr_actor',
          resolvedAt: '2026-08-10T14:00:00.000Z',
        },
      })
    },
  )

  it('reopens a resolved comment for its author and audits the transition', async () => {
    const database = new TestDatabase({ access: 'edit' })
    const existing = database.seedComment({
      authorId: 'usr_actor',
      resolvedAt: '2026-08-10T14:00:00.000Z',
      resolvedBy: 'usr_actor',
    })
    const app = routeApp(database).app

    const reopened = await reopenComment(app, existing.id)

    expect(reopened.status).toBe(200)
    await expect(reopened.json()).resolves.toMatchObject({
      comment: { id: existing.id, resolvedAt: null, resolvedBy: null },
    })
    expect(database.comments.get(existing.id)).toMatchObject({
      resolvedAt: null,
      resolvedBy: null,
    })
    expect(database.audits.map(({ action }) => action)).toEqual([
      'document.comment_reopen',
    ])
  })

  it('forbids a non-author member from reopening and hides a missing reopen target', async () => {
    const database = new TestDatabase({ access: 'edit' })
    const existing = database.seedComment({
      authorId: 'usr_owner',
      resolvedAt: '2026-08-10T14:00:00.000Z',
      resolvedBy: 'usr_owner',
    })
    const app = routeApp(database).app

    const forbidden = await reopenComment(app, existing.id)
    const missing = await reopenComment(app, 'cmt_missing')

    expect(forbidden.status).toBe(403)
    await expectDocument404(missing)
    expect(database.comments.get(existing.id)?.resolvedAt).not.toBeNull()
    expect(database.audits).toEqual([])
  })

  it('stores a cross-paragraph anchor through the create route', async () => {
    const database = new TestDatabase({ access: 'edit' })
    const response = await createComment(routeApp(database).app, {
      body: 'Spanning review',
      anchor: {
        paragraphId: 'para-1',
        startOffset: 10,
        endParagraphId: 'para-2',
        endOffset: 6,
      },
    })

    expect(response.status).toBe(201)
    const stored = [...database.comments.values()][0]
    expect(stored).toMatchObject({
      paragraphId: 'para-1',
      endParagraphId: 'para-2',
      startOffset: 10,
      endOffset: 6,
    })
  })

  it.each([
    [
      'an end paragraph that precedes the start',
      {
        paragraphId: 'para-2',
        startOffset: 0,
        endParagraphId: 'para-1',
        endOffset: 1,
      },
    ],
    [
      'a missing end paragraph',
      {
        paragraphId: 'para-1',
        startOffset: 5,
        endParagraphId: 'para-missing',
        endOffset: 0,
      },
    ],
  ])('rejects %s before storing a comment', async (_name, anchor) => {
    const database = new TestDatabase({ access: 'edit' })
    const response = await createComment(routeApp(database).app, {
      body: 'Review',
      anchor,
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'comment_anchor_unresolved' },
    })
    expect(database.comments.size).toBe(0)
  })

  it('replays a retried create by client key without a duplicate or audit', async () => {
    const database = new TestDatabase({ access: 'edit' })
    const app = routeApp(database).app
    const body = {
      body: 'Idempotent review',
      anchor: { paragraphId: 'para-1', startOffset: 4, endOffset: 8 },
      clientKey: 'submit-1',
    }

    const first = await createComment(app, body)
    const second = await createComment(app, body)

    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    const firstComment = (await first.json()) as { comment: { id: string } }
    const secondComment = (await second.json()) as { comment: { id: string } }
    expect(secondComment.comment.id).toBe(firstComment.comment.id)
    expect(database.comments.size).toBe(1)
    expect(database.audits.map(({ action }) => action)).toEqual([
      'document.comment_create',
    ])
  })

  it('lets a different author reuse the same client key', async () => {
    const database = new TestDatabase({ access: 'edit' })
    const first = await createComment(routeApp(database).app, {
      body: 'First author',
      anchor: { paragraphId: 'para-1', startOffset: 0, endOffset: 1 },
      clientKey: 'shared-key',
    })
    const second = await createComment(
      routeApp(database, {
        id: 'usr_other',
        name: 'Other Reviewer',
        organisationId: 'org_1',
        role: 'member',
      }).app,
      {
        body: 'Second author',
        anchor: { paragraphId: 'para-1', startOffset: 0, endOffset: 1 },
        clientKey: 'shared-key',
      },
    )

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(database.comments.size).toBe(2)
  })

  it('creates a reply on a product thread and audits it', async () => {
    const database = new TestDatabase({ access: 'edit' })
    const existing = database.seedComment()
    const privateBody = 'Synthetic confidential reply'
    const app = routeApp(database).app

    const reply = await replyToComment(app, existing.id, {
      body: privateBody,
    })

    expect(reply.status).toBe(201)
    expect(reply.headers.get('cache-control')).toBe('no-store')
    await expect(reply.json()).resolves.toMatchObject({
      reply: {
        body: privateBody,
        author: { id: 'usr_actor' },
        imported: false,
      },
    })
    expect([...database.replies.values()]).toHaveLength(1)
    expect(database.audits.map(({ action }) => action)).toEqual([
      'document.comment_reply',
    ])
    expect(JSON.stringify(database.audits)).not.toContain(privateBody)
  })

  it('rejects a reply to a missing or cross-scope product comment', async () => {
    const database = new TestDatabase({ access: 'edit' })
    const otherScope = database.seedComment({ documentId: 'doc_2' })
    const app = routeApp(database).app

    const missing = await replyToComment(app, 'cmt_missing', {
      body: 'Reply',
    })
    const crossScope = await replyToComment(app, otherScope.id, {
      body: 'Reply',
    })

    await expectDocument404(missing)
    await expectDocument404(crossScope)
    expect(database.replies.size).toBe(0)
    expect(database.audits).toEqual([])
    expect(database.transactionCommands).toEqual([
      'begin',
      'rollback',
      'begin',
      'rollback',
    ])
  })

  it('rejects a view grantee reply before touching comment tables', async () => {
    const database = new TestDatabase({ access: 'view' })
    const existing = database.seedComment()

    const reply = await replyToComment(routeApp(database).app, existing.id, {
      body: 'Reply',
    })

    await expectDocument404(reply)
    expect(database.replies.size).toBe(0)
    expect(database.audits).toEqual([])
  })

  it('attaches a reply to an imported thread head under its ooxml identity', async () => {
    const database = new TestDatabase({ access: 'edit' })
    const importedHead: DocumentImportedComment = {
      id: 'ooxml-3',
      ooxmlId: 3,
      author: 'Alice Example',
      createdAt: '2026-08-01T09:00:00.000Z',
      body: 'Imported file comment',
      bodyTruncated: false,
      paraId: 'A1B2C3D4',
      anchor: { paragraphId: 'para-1', startOffset: 0, endOffset: 4 },
      resolved: false,
      parentId: null,
    }
    const storage = new MemoryStorage(
      cachedCommentModelJsonWith([importedHead]),
    )
    const app = routeApp(database, undefined, storage).app

    const reply = await replyToComment(app, 'ooxml-3', { body: 'Threaded' })

    expect(reply.status).toBe(201)
    const stored = [...database.replies.values()][0]
    expect(stored).toMatchObject({
      importedCommentId: 'ooxml-3',
      commentId: null,
    })
  })

  it('threads a reply to an imported reply under its head', async () => {
    const database = new TestDatabase({ access: 'edit' })
    const imported = [
      {
        id: 'ooxml-3',
        ooxmlId: 3,
        author: 'Alice Example',
        createdAt: null,
        body: 'Imported head',
        bodyTruncated: false,
        paraId: 'A1B2C3D4',
        anchor: { paragraphId: 'para-1', startOffset: 0, endOffset: 4 },
        resolved: false,
        parentId: null,
      },
      {
        id: 'ooxml-4',
        ooxmlId: 4,
        author: null,
        createdAt: null,
        body: 'Imported reply',
        bodyTruncated: false,
        paraId: null,
        anchor: null,
        resolved: false,
        parentId: 'ooxml-3',
      },
    ] satisfies DocumentImportedComment[]
    const storage = new MemoryStorage(cachedCommentModelJsonWith(imported))
    const app = routeApp(database, undefined, storage).app

    const reply = await replyToComment(app, 'ooxml-4', { body: 'Deep reply' })

    expect(reply.status).toBe(201)
    expect([...database.replies.values()][0]).toMatchObject({
      importedCommentId: 'ooxml-3',
    })
  })

  it.each([
    ['an anonymous imported comment', 'ooxml-anon-0'],
    ['an imported id absent from this version', 'ooxml-99'],
  ])('refuses a reply to %s', async (_name, parent) => {
    const database = new TestDatabase({ access: 'edit' })
    const anonymous: DocumentImportedComment = {
      id: 'ooxml-anon-0',
      ooxmlId: null,
      author: null,
      createdAt: null,
      body: 'Anonymous comment',
      bodyTruncated: false,
      paraId: null,
      anchor: null,
      resolved: false,
      parentId: null,
    }
    const storage = new MemoryStorage(cachedCommentModelJsonWith([anonymous]))
    const reply = await replyToComment(
      routeApp(database, undefined, storage).app,
      parent,
      { body: 'Reply' },
    )

    await expectDocument404(reply)
    expect(database.replies.size).toBe(0)
  })

  it('merges imported threads, product replies, and orphaned replies in the list', async () => {
    const database = new TestDatabase({ access: 'edit' })
    const product = database.seedComment({ authorId: 'usr_actor' })
    database.seedReply({
      id: 'cmtr_product',
      commentId: product.id,
      body: 'Product reply',
    })
    const importedHead = {
      id: 'ooxml-3',
      ooxmlId: 3,
      author: 'Alice Example',
      createdAt: '2026-08-01T09:00:00.000Z',
      body: 'Imported head',
      bodyTruncated: false,
      paraId: 'A1B2C3D4',
      anchor: { paragraphId: 'para-1', startOffset: 0, endOffset: 4 },
      resolved: true,
      parentId: null,
    } satisfies DocumentImportedComment
    database.seedReply({
      id: 'cmtr_imported',
      importedCommentId: 'ooxml-3',
      importedParentFingerprint: importedCommentFingerprint(importedHead),
      body: 'Reply on the file thread',
    })
    database.seedReply({
      id: 'cmtr_orphan',
      importedCommentId: 'ooxml-99',
      body: 'Reply to a thread this version no longer carries',
    })
    const imported = [
      importedHead,
      {
        id: 'ooxml-4',
        ooxmlId: 4,
        author: 'Bob Example',
        createdAt: null,
        body: 'Imported file reply',
        bodyTruncated: false,
        paraId: null,
        anchor: null,
        resolved: false,
        parentId: 'ooxml-3',
      },
    ] satisfies DocumentImportedComment[]
    const storage = new MemoryStorage(cachedCommentModelJsonWith(imported))

    const response = await routeApp(database, undefined, storage).app.request(
      '/api/documents/doc_1/comments',
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      comments: Array<{
        id: string
        anchorResolved: boolean
        replies: Array<{ id: string; imported: boolean }>
      }>
      importedComments: Array<{
        id: string
        resolved: boolean
        replies: Array<{ id: string; imported: boolean }>
      }>
      orphanedReplies: Array<{ id: string }>
    }
    expect(body.comments).toEqual([
      expect.objectContaining({
        id: product.id,
        anchorResolved: true,
        replies: [
          expect.objectContaining({ id: 'cmtr_product', imported: false }),
        ],
      }),
    ])
    expect(body.importedComments).toEqual([
      expect.objectContaining({
        id: 'ooxml-3',
        resolved: true,
        replies: [
          expect.objectContaining({ id: 'ooxml-4', imported: true }),
          expect.objectContaining({ id: 'cmtr_imported', imported: false }),
        ],
      }),
    ])
    expect(body.orphanedReplies).toEqual([
      expect.objectContaining({ id: 'cmtr_orphan' }),
    ])
  })

  it('marks a product comment anchorResolved false when the model moved past it', async () => {
    const database = new TestDatabase({ access: 'edit' })
    // Anchor beyond the model paragraph's length: still listed, honestly
    // flagged unresolved rather than re-anchored or dropped.
    database.seedComment({ startOffset: 500, endOffset: 900 })

    const response = await routeApp(database).app.request(
      '/api/documents/doc_1/comments',
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      comments: Array<{ anchorResolved: boolean }>
    }
    expect(body.comments[0]?.anchorResolved).toBe(false)
  })

  it('conflicts when a comment client key is reused with a different payload', async () => {
    const database = new TestDatabase({ access: 'edit' })
    const app = routeApp(database).app
    const first = await createComment(app, {
      body: 'First intent',
      anchor: { paragraphId: 'para-1', startOffset: 0, endOffset: 1 },
      clientKey: 'submit-1',
    })
    const differentBody = await createComment(app, {
      body: 'Second intent',
      anchor: { paragraphId: 'para-1', startOffset: 0, endOffset: 1 },
      clientKey: 'submit-1',
    })
    const differentAnchor = await createComment(app, {
      body: 'First intent',
      anchor: { paragraphId: 'para-1', startOffset: 4, endOffset: 8 },
      clientKey: 'submit-1',
    })

    expect(first.status).toBe(201)
    for (const response of [differentBody, differentAnchor]) {
      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'comment_client_key_conflict' },
      })
    }
    // Neither conflicting submit wrote a row, audited, or replaced the first.
    expect(database.comments.size).toBe(1)
    expect(database.audits.map(({ action }) => action)).toEqual([
      'document.comment_create',
    ])
  })

  it('replays a key whose endParagraphId repeats the start paragraph', async () => {
    const database = new TestDatabase({ access: 'edit' })
    const app = routeApp(database).app

    const first = await createComment(app, {
      body: 'Same intent',
      anchor: { paragraphId: 'para-1', startOffset: 0, endOffset: 1 },
      clientKey: 'submit-1',
    })
    // endParagraphId naming the start paragraph stores identically to an
    // absent one, so the retry is the same intent — a replay, not a conflict.
    const retried = await createComment(app, {
      body: 'Same intent',
      anchor: {
        paragraphId: 'para-1',
        startOffset: 0,
        endOffset: 1,
        endParagraphId: 'para-1',
      },
      clientKey: 'submit-1',
    })

    expect(first.status).toBe(201)
    expect(retried.status).toBe(200)
    expect(database.comments.size).toBe(1)
  })

  it('replays a retried reply by client key without a duplicate', async () => {
    const database = new TestDatabase({ access: 'edit' })
    const existing = database.seedComment()
    const app = routeApp(database).app
    const body = { body: 'Idempotent reply', clientKey: 'reply-1' }

    const first = await replyToComment(app, existing.id, body)
    const second = await replyToComment(app, existing.id, body)

    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    const firstReply = (await first.json()) as { reply: { id: string } }
    const secondReply = (await second.json()) as { reply: { id: string } }
    expect(secondReply.reply.id).toBe(firstReply.reply.id)
    expect(database.replies.size).toBe(1)
    expect(database.audits.map(({ action }) => action)).toEqual([
      'document.comment_reply',
    ])
  })

  it('conflicts when a reply client key is reused with a different payload', async () => {
    const database = new TestDatabase({ access: 'edit' })
    const first = database.seedComment()
    const second = database.seedComment()
    const app = routeApp(database).app

    const created = await replyToComment(app, first.id, {
      body: 'Reply intent',
      clientKey: 'reply-1',
    })
    const differentBody = await replyToComment(app, first.id, {
      body: 'Changed reply intent',
      clientKey: 'reply-1',
    })
    const differentParent = await replyToComment(app, second.id, {
      body: 'Reply intent',
      clientKey: 'reply-1',
    })

    expect(created.status).toBe(201)
    for (const response of [differentBody, differentParent]) {
      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'comment_client_key_conflict' },
      })
    }
    expect(database.replies.size).toBe(1)
    expect(database.audits.map(({ action }) => action)).toEqual([
      'document.comment_reply',
    ])
  })

  it('pins an imported reply to the served head identity', async () => {
    const database = new TestDatabase({ access: 'edit' })
    const importedHead: DocumentImportedComment = {
      id: 'ooxml-3',
      ooxmlId: 3,
      author: 'Alice Example',
      createdAt: '2026-08-01T09:00:00.000Z',
      body: 'Imported file comment',
      bodyTruncated: false,
      paraId: 'A1B2C3D4',
      anchor: { paragraphId: 'para-1', startOffset: 0, endOffset: 4 },
      resolved: false,
      parentId: null,
    }
    const storage = new MemoryStorage(
      cachedCommentModelJsonWith([importedHead]),
    )
    const app = routeApp(database, undefined, storage).app

    const reply = await replyToComment(app, 'ooxml-3', { body: 'Threaded' })

    expect(reply.status).toBe(201)
    const stored = [...database.replies.values()][0]
    expect(stored).toMatchObject({
      importedCommentId: 'ooxml-3',
      commentId: null,
    })
    expect(stored?.importedParentFingerprint).toBe(
      importedCommentFingerprint(importedHead),
    )
  })

  it('orphans replies whose imported head no longer matches, fingerprinted or not', async () => {
    const database = new TestDatabase({ access: 'edit' })
    const importedHead = {
      id: 'ooxml-3',
      ooxmlId: 3,
      author: 'Alice Example',
      createdAt: '2026-08-01T09:00:00.000Z',
      body: 'Imported head',
      bodyTruncated: false,
      paraId: 'A1B2C3D4',
      anchor: { paragraphId: 'para-1', startOffset: 0, endOffset: 4 },
      resolved: false,
      parentId: null,
    } satisfies DocumentImportedComment
    database.seedReply({
      id: 'cmtr_attached',
      importedCommentId: 'ooxml-3',
      importedParentFingerprint: importedCommentFingerprint(importedHead),
      body: 'Written against this thread',
    })
    database.seedReply({
      id: 'cmtr_mismatch',
      importedCommentId: 'ooxml-3',
      importedParentFingerprint: 'f'.repeat(64),
      body: 'Written against a thread this w:id no longer holds',
    })
    database.seedReply({
      id: 'cmtr_unverified',
      importedCommentId: 'ooxml-3',
      body: 'Written before fingerprints existed',
    })
    const storage = new MemoryStorage(
      cachedCommentModelJsonWith([importedHead]),
    )

    const response = await routeApp(database, undefined, storage).app.request(
      '/api/documents/doc_1/comments',
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      importedComments: Array<{
        id: string
        replies: Array<{ id: string }>
      }>
      orphanedReplies: Array<{ id: string }>
    }
    // Only the fingerprint-matched reply threads; a mismatched or unverified
    // identity orphans honestly rather than attaching to the w:id slot.
    expect(body.importedComments).toEqual([
      expect.objectContaining({
        id: 'ooxml-3',
        replies: [expect.objectContaining({ id: 'cmtr_attached' })],
      }),
    ])
    expect(body.orphanedReplies).toEqual([
      expect.objectContaining({ id: 'cmtr_mismatch' }),
      expect.objectContaining({ id: 'cmtr_unverified' }),
    ])
  })

  it('renders resolution replies from the pre-commit thread read', async () => {
    const database = new TestDatabase({ access: 'edit' })
    const existing = database.seedComment({ authorId: 'usr_actor' })
    database.seedReply({ commentId: existing.id, body: 'Thread reply' })
    const app = routeApp(database).app

    const resolved = await resolveComment(app, existing.id)

    expect(resolved.status).toBe(200)
    await expect(resolved.json()).resolves.toMatchObject({
      comment: { replies: [{ body: 'Thread reply' }] },
    })
    // The replies came from the transaction's own thread read; the route must
    // not re-list comments after commit to assemble the response.
    expect(
      database.queries.some((sql) => sql.includes('comment_id = $1')),
    ).toBe(true)
    expect(
      database.queries.some((sql) =>
        sql.includes('left join document_comments'),
      ),
    ).toBe(false)
  })
})
