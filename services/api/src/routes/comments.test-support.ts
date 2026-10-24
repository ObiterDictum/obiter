import { TestDatabase } from './comments-database.test-support'
export { TestDatabase } from './comments-database.test-support'
import type {
  DocumentImportedComment,
  DocumentModelWire,
} from '@obiter/contracts'
import type { AuthzUser } from '../authz'
import { createCommentsRoutes } from './comments'
import {
  createRouteApp,
  expectDocument404,
  MemoryStorage as SharedMemoryStorage,
  modelObjectKey,
} from './document-route.test-support'

const commentModel = {
  version: 1,
  stories: [
    {
      partName: 'word/document.xml',
      kind: 'document',
      paragraphs: [
        {
          id: 'para-1',
          runs: [
            {
              id: 'text-1',
              textRevisionEligible: true,
              text: 'A😀 synthetic paragraph',
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
        {
          id: 'para-2',
          runs: [
            {
              id: 'text-2',
              textRevisionEligible: true,
              text: 'Second synthetic paragraph',
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
      ],
      preservedXmlFragments: [],
      fields: [],
      unanchoredFieldParagraphIds: [],
    },
  ],
  styles: [],
  numbering: [],
  relationships: [],
  preservedXmlFragments: [],
  changes: [],
  comments: [],
  trackRevisions: false,
  markings: {
    documentKind: null,
    draft: false,
    privileged: false,
    withoutPrejudice: false,
  },
} satisfies DocumentModelWire

export const cachedCommentModelJson = JSON.stringify(commentModel)

/** A model variant carrying package-imported comments for reply/list tests. */
export function cachedCommentModelJsonWith(
  comments: DocumentImportedComment[],
) {
  return JSON.stringify({ ...commentModel, comments })
}

export { expectDocument404, modelObjectKey }

export class MemoryStorage extends SharedMemoryStorage {
  constructor(modelJson = cachedCommentModelJson) {
    super({ text: [[modelObjectKey, modelJson]] })
  }
}

export function routeApp(
  database: TestDatabase,
  user: AuthzUser | null = {
    id: 'usr_actor',
    name: 'Case Reviewer',
    organisationId: 'org_1',
    role: 'member',
  },
  storage = new MemoryStorage(),
) {
  return {
    ...createRouteApp({
      database,
      storage,
      user,
      requestId: 'req_comments',
      createRoutes: createCommentsRoutes,
    }),
    storage,
  }
}

export function createComment(
  app: ReturnType<typeof routeApp>['app'],
  body: unknown,
) {
  return app.request('/api/documents/doc_1/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function replyToComment(
  app: ReturnType<typeof routeApp>['app'],
  commentId: string,
  body: unknown,
) {
  return app.request(`/api/documents/doc_1/comments/${commentId}/replies`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function resolveComment(
  app: ReturnType<typeof routeApp>['app'],
  commentId: string,
  body: unknown = {},
) {
  return app.request(`/api/documents/doc_1/comments/${commentId}/resolve`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function reopenComment(
  app: ReturnType<typeof routeApp>['app'],
  commentId: string,
  body: unknown = {},
) {
  return app.request(`/api/documents/doc_1/comments/${commentId}/reopen`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
