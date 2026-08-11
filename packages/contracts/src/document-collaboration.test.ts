import { describe, expect, it } from 'vitest'

import {
  DOCUMENT_COLLABORATION_PARTICIPANT_MAX_COUNT,
  documentCollaborationConflictResponseSchema,
  documentCollaborationMergeRequestSchema,
  documentCollaborationMergeResponseSchema,
  documentCollaborationSyncResponseSchema,
  documentPresenceUpdateRequestSchema,
} from './document-collaboration'

describe('document collaboration contracts', () => {
  const cursor = { paragraphId: 'para_1', runId: 'run_1', offset: 3 }

  it('accepts bounded presence, sync, merge, and conflict shapes', () => {
    expect(documentPresenceUpdateRequestSchema.parse({ cursor })).toEqual({
      cursor,
    })
    expect(
      documentCollaborationSyncResponseSchema.parse({
        documentId: 'doc_1',
        currentVersionId: 'ver_2',
        currentVersionNumber: 2,
        changed: true,
        participants: [{ userId: 'usr_1', cursor }],
      }),
    ).toMatchObject({ participants: [{ userId: 'usr_1', cursor }] })
    expect(
      documentCollaborationMergeRequestSchema.parse({
        baseVersionId: 'ver_1',
        syncId: 'sync_1',
        operations: [
          { type: 'replace_run_text', runId: 'run_1', text: 'Revised' },
        ],
      }),
    ).toMatchObject({ syncId: 'sync_1' })
    expect(
      documentCollaborationMergeResponseSchema.parse({
        documentId: 'doc_1',
        syncId: 'sync_1',
        baseVersionId: 'ver_1',
        versionId: 'ver_2',
        versionNumber: 2,
        outcome: 'merged',
      }),
    ).toMatchObject({ outcome: 'merged' })
    expect(
      documentCollaborationConflictResponseSchema.parse({
        error: {
          code: 'conflict_detected',
          message: 'The edits overlap.',
          requestId: 'req_1',
        },
        conflict: {
          documentId: 'doc_1',
          syncId: 'sync_1',
          baseVersionId: 'ver_1',
          currentVersionId: 'ver_2',
          currentVersionNumber: 2,
          operationIndexes: [0, 2],
        },
      }),
    ).toMatchObject({ conflict: { operationIndexes: [0, 2] } })
  })

  it('rejects content-bearing, unbounded, duplicate, and unknown fields', () => {
    expect(
      documentPresenceUpdateRequestSchema.safeParse({
        cursor,
        selectedText: 'private selection',
      }).success,
    ).toBe(false)
    expect(
      documentCollaborationSyncResponseSchema.safeParse({
        documentId: 'doc_1',
        currentVersionId: 'ver_2',
        currentVersionNumber: 2,
        changed: false,
        participants: Array.from(
          { length: DOCUMENT_COLLABORATION_PARTICIPANT_MAX_COUNT + 1 },
          (_, index) => ({ userId: `usr_${index}`, cursor }),
        ),
      }).success,
    ).toBe(false)
    expect(
      documentCollaborationConflictResponseSchema.safeParse({
        error: {
          code: 'conflict_detected',
          message: 'The edits overlap.',
          requestId: 'req_1',
        },
        conflict: {
          documentId: 'doc_1',
          syncId: 'sync_1',
          baseVersionId: 'ver_1',
          currentVersionId: 'ver_2',
          currentVersionNumber: 2,
          operationIndexes: [0, 0],
        },
      }).success,
    ).toBe(false)
    expect(
      documentCollaborationMergeRequestSchema.safeParse({
        baseVersionId: 'ver_1',
        syncId: 'sync_1',
        operations: [
          { type: 'replace_run_text', runId: 'run_1', text: 'Revised' },
        ],
        model: { stories: [] },
      }).success,
    ).toBe(false)
  })
})
