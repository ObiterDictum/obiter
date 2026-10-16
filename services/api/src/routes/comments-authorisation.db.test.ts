import { afterAll, describe, expect, it } from 'bun:test'
import type { DocumentImportedComment } from '@obiter/contracts'
import { importedCommentFingerprint } from '../imported-comment-fingerprint'
import { createTestPool } from '../test-database.test-support'
import {
  anchor,
  app,
  cleanupMatter,
  editorUser,
  expectConcealed,
  jsonRequest,
  ownerUser,
  seedMatter,
  storageFor,
} from './document-write-share-revocation.test-support'

/**
 * Route-level authorisation and comment semantics against a real database:
 * view shares read but never write, strangers see nothing, resolution is
 * author-or-manager, client-key reuse replays or conflicts honestly, and an
 * imported reply is bound to the head identity served when it was written.
 */

const pool = createTestPool()

const importedHead: DocumentImportedComment = {
  id: 'ooxml-3',
  ooxmlId: 3,
  author: 'File Reviewer',
  createdAt: '2026-08-10T10:00:00.000Z',
  body: 'File-carried thread head',
  bodyTruncated: false,
  paraId: '0B1E0003',
  anchor: null,
  resolved: false,
  parentId: null,
}

describe('document comment authorisation', () => {
  it('lets a view grantee list but not write comments', async () => {
    const seed = await seedMatter(pool, 'view')
    try {
      const storage = storageFor(seed)
      const viewer = app(pool, storage, editorUser(seed), 'req_view_authz')

      const listed = await viewer.request(
        `/api/documents/${seed.documentId}/comments`,
      )
      expect(listed.status).toBe(200)
      await expect(listed.json()).resolves.toMatchObject({
        comments: [{ id: seed.commentId }],
      })

      await expectConcealed(
        await viewer.request(
          `/api/documents/${seed.documentId}/comments`,
          jsonRequest('POST', { body: 'Denied comment', anchor }),
        ),
      )
      await expectConcealed(
        await viewer.request(
          `/api/documents/${seed.documentId}/comments/${seed.commentId}/replies`,
          jsonRequest('POST', { body: 'Denied reply' }),
        ),
      )
      await expectConcealed(
        await viewer.request(
          `/api/documents/${seed.documentId}/comments/${seed.commentId}/resolve`,
          jsonRequest('PATCH', {}),
        ),
      )

      const comments = await pool.query<{ n: number }>(
        `select count(*)::int as n from document_comments
         where document_id = $1`,
        [seed.documentId],
      )
      const replies = await pool.query<{ n: number }>(
        `select count(*)::int as n from document_comment_replies
         where document_id = $1`,
        [seed.documentId],
      )
      expect(comments.rows[0]?.n).toBe(1)
      expect(replies.rows[0]?.n).toBe(0)
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('conceals the document and its comments from another organisation', async () => {
    const seed = await seedMatter(pool, null)
    try {
      const stranger = app(
        pool,
        storageFor(seed),
        {
          id: seed.strangerId,
          organisationId: seed.otherOrgId,
          role: 'member',
        },
        'req_stranger',
      )
      await expectConcealed(
        await stranger.request(`/api/documents/${seed.documentId}/comments`),
      )
      await expectConcealed(
        await stranger.request(
          `/api/documents/${seed.documentId}/comments`,
          jsonRequest('POST', { body: 'Denied', anchor }),
        ),
      )
      await expectConcealed(
        await stranger.request(
          `/api/documents/${seed.documentId}/comments/${seed.commentId}/replies`,
          jsonRequest('POST', { body: 'Denied' }),
        ),
      )
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('enforces author-or-manager resolution against the row, not the claim', async () => {
    const seed = await seedMatter(pool, 'edit')
    try {
      const ownerCommentId = `cmt_owner_${seed.documentId}`
      await pool.query(
        `insert into document_comments (
           id, organisation_id, matter_id, document_id, anchor_version_id,
           paragraph_id, start_offset, end_offset, body, author_id,
           author_name, resolved_at, resolved_by, created_at, updated_at
         ) values ($1, $2, $3, $4, $5, $6, 0, 1, 'Owner comment', $7,
           'Race Owner', null, null, now(), now())`,
        [
          ownerCommentId,
          seed.orgId,
          seed.matterId,
          seed.documentId,
          seed.versionId,
          anchor.paragraphId,
          seed.ownerId,
        ],
      )

      const editor = app(pool, storageFor(seed), editorUser(seed), 'req_authz')
      const forbidden = await editor.request(
        `/api/documents/${seed.documentId}/comments/${ownerCommentId}/resolve`,
        jsonRequest('PATCH', {}),
      )
      expect(forbidden.status).toBe(403)
      await expect(forbidden.json()).resolves.toMatchObject({
        error: { code: 'forbidden' },
      })

      const owner = app(pool, storageFor(seed), ownerUser(seed), 'req_authz')
      const resolved = await owner.request(
        `/api/documents/${seed.documentId}/comments/${ownerCommentId}/resolve`,
        jsonRequest('PATCH', {}),
      )
      expect(resolved.status).toBe(200)
      await expect(resolved.json()).resolves.toMatchObject({
        comment: { id: ownerCommentId },
      })
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('replays a reused client key and conflicts on a different intent', async () => {
    const seed = await seedMatter(pool, 'edit')
    try {
      const writer = app(pool, storageFor(seed), editorUser(seed), 'req_keys')
      const path = `/api/documents/${seed.documentId}/comments`

      const first = await writer.request(
        path,
        jsonRequest('POST', {
          body: 'Key-bound comment',
          anchor,
          clientKey: 'comment-key-1',
        }),
      )
      expect(first.status).toBe(201)
      const firstBody = (await first.json()) as {
        comment: { id: string }
      }

      const replay = await writer.request(
        path,
        jsonRequest('POST', {
          body: 'Key-bound comment',
          anchor,
          clientKey: 'comment-key-1',
        }),
      )
      expect(replay.status).toBe(200)
      await expect(replay.json()).resolves.toMatchObject({
        comment: { id: firstBody.comment.id },
      })

      const conflict = await writer.request(
        path,
        jsonRequest('POST', {
          body: 'A different intent',
          anchor,
          clientKey: 'comment-key-1',
        }),
      )
      expect(conflict.status).toBe(409)
      await expect(conflict.json()).resolves.toMatchObject({
        error: { code: 'comment_client_key_conflict' },
      })

      const repliesPath = `/api/documents/${seed.documentId}/comments/${seed.commentId}/replies`
      const reply = await writer.request(
        repliesPath,
        jsonRequest('POST', { body: 'Key-bound reply', clientKey: 'rk-1' }),
      )
      expect(reply.status).toBe(201)
      const replyConflict = await writer.request(
        repliesPath,
        jsonRequest('POST', { body: 'Changed reply', clientKey: 'rk-1' }),
      )
      expect(replyConflict.status).toBe(409)
      await expect(replyConflict.json()).resolves.toMatchObject({
        error: { code: 'comment_client_key_conflict' },
      })

      const comments = await pool.query<{ n: number }>(
        `select count(*)::int as n from document_comments
         where document_id = $1`,
        [seed.documentId],
      )
      const replies = await pool.query<{ n: number }>(
        `select count(*)::int as n from document_comment_replies
         where document_id = $1`,
        [seed.documentId],
      )
      expect(comments.rows[0]?.n).toBe(2)
      expect(replies.rows[0]?.n).toBe(1)
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('stores deliberate duplicates as distinct rows under distinct keys', async () => {
    const seed = await seedMatter(pool, 'edit')
    try {
      const writer = app(pool, storageFor(seed), editorUser(seed), 'req_dupes')
      const path = `/api/documents/${seed.documentId}/comments`
      const body = { body: 'Deliberately repeated wording', anchor }

      const first = await writer.request(
        path,
        jsonRequest('POST', { ...body, clientKey: 'dup-comment-a' }),
      )
      const second = await writer.request(
        path,
        jsonRequest('POST', { ...body, clientKey: 'dup-comment-b' }),
      )
      expect(first.status).toBe(201)
      expect(second.status).toBe(201)
      const firstId = ((await first.json()) as { comment: { id: string } })
        .comment.id
      const secondId = ((await second.json()) as { comment: { id: string } })
        .comment.id
      expect(secondId).not.toBe(firstId)

      const repliesPath = `/api/documents/${seed.documentId}/comments/${seed.commentId}/replies`
      const firstReply = await writer.request(
        repliesPath,
        jsonRequest('POST', { body: 'Same reply twice', clientKey: 'dup-r-a' }),
      )
      const secondReply = await writer.request(
        repliesPath,
        jsonRequest('POST', { body: 'Same reply twice', clientKey: 'dup-r-b' }),
      )
      expect(firstReply.status).toBe(201)
      expect(secondReply.status).toBe(201)
      const firstReplyId = (
        (await firstReply.json()) as { reply: { id: string } }
      ).reply.id
      const secondReplyId = (
        (await secondReply.json()) as { reply: { id: string } }
      ).reply.id
      expect(secondReplyId).not.toBe(firstReplyId)

      const comments = await pool.query<{ n: number }>(
        `select count(*)::int as n from document_comments
         where document_id = $1`,
        [seed.documentId],
      )
      const replies = await pool.query<{ n: number }>(
        `select count(*)::int as n from document_comment_replies
         where document_id = $1`,
        [seed.documentId],
      )
      expect(comments.rows[0]?.n).toBe(3)
      expect(replies.rows[0]?.n).toBe(2)
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('binds an imported reply to the head identity served when written', async () => {
    const seed = await seedMatter(pool, 'edit')
    try {
      const storage = storageFor(seed)
      const modelJson = storage.text.get(seed.modelKey)
      if (!modelJson) throw new Error('Seeded model is missing.')
      const model = JSON.parse(modelJson) as { comments: unknown[] }
      storage.text.set(
        seed.modelKey,
        JSON.stringify({ ...model, comments: [importedHead] }),
      )

      const writer = app(pool, storage, editorUser(seed), 'req_imported')
      const created = await writer.request(
        `/api/documents/${seed.documentId}/comments/${importedHead.id}/replies`,
        jsonRequest('POST', { body: 'Threaded under the file head' }),
      )
      expect(created.status).toBe(201)

      const rows = await pool.query<{
        imported_parent_fingerprint: string | null
      }>(
        `select imported_parent_fingerprint from document_comment_replies
         where document_id = $1`,
        [seed.documentId],
      )
      expect(rows.rows).toHaveLength(1)
      expect(rows.rows[0]?.imported_parent_fingerprint).toBe(
        importedCommentFingerprint(importedHead),
      )

      // A later version reuses the same w:id for a different thread: the
      // reply must surface as orphaned rather than attach on the slot alone.
      storage.text.set(
        seed.modelKey,
        JSON.stringify({
          ...model,
          comments: [
            { ...importedHead, body: 'A different thread under the same id' },
          ],
        }),
      )
      const listed = await writer.request(
        `/api/documents/${seed.documentId}/comments`,
      )
      expect(listed.status).toBe(200)
      const body = (await listed.json()) as {
        importedComments: Array<{ id: string; replies: unknown[] }>
        orphanedReplies: Array<{ id: string }>
      }
      expect(body.importedComments[0]?.replies).toEqual([])
      expect(body.orphanedReplies).toHaveLength(1)
    } finally {
      await cleanupMatter(pool, seed)
    }
  })
})

afterAll(async () => {
  await pool.end()
})
