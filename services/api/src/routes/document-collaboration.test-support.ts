import type { AuthzUser } from '../authz'
import { parseDocx } from '@obiter/ooxml'
import { DocumentPresenceRegistry } from '../document-presence'
import { createDocumentCollaborationRoutes } from './document-collaboration'
import {
  EditDatabase,
  EditStorage,
  sourceBytes,
} from './document-edit.test-support'
import { createRouteApp } from './document-route.test-support'

const sourceDocument = await parseDocx(sourceBytes)
const mainParagraphs =
  sourceDocument.model.stories.find(({ kind }) => kind === 'document')
    ?.paragraphs ?? []
export const firstParagraph = mainParagraphs[0]
export const firstRun = firstParagraph?.runs[0]
export const secondRun = mainParagraphs.flatMap(({ runs }) => runs)[1]
if (!firstParagraph || !firstRun || !secondRun) {
  throw new Error('Collaboration fixture regions are missing.')
}
export const cursor = {
  paragraphId: firstParagraph.id,
  runId: firstRun.id,
  offset: 2,
}

export function collaborationApp(
  database: EditDatabase,
  presence = new DocumentPresenceRegistry(),
  user: AuthzUser | null | undefined = {
    id: 'usr_editor',
    name: 'Session Editor',
    organisationId: 'org_1',
    role: 'member',
  },
  storage = new EditStorage(),
) {
  return {
    ...createRouteApp({
      database,
      storage,
      user,
      requestId: 'req_collaboration',
      createRoutes: (pool, routeStorage) =>
        createDocumentCollaborationRoutes(pool, routeStorage, presence),
    }),
    database,
    storage,
  }
}

export function presenceRequest(value: typeof cursor | null) {
  return {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cursor: value }),
  }
}

export function mergeRequest(
  baseVersionId: string,
  syncId: string,
  runId: string,
  text: string,
) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseVersionId,
      syncId,
      operations: [{ type: 'replace_run_text', runId, text }],
    }),
  }
}
