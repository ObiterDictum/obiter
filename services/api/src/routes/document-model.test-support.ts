import { readFile } from 'node:fs/promises'
import type { AuthzUser } from '../authz'
import { parseDocx, serialiseModelJson } from '@obiter/ooxml'
import { createDocumentModelRoutes } from './document-model'
import {
  createRouteApp,
  expectDocument404,
  MemoryStorage as SharedMemoryStorage,
  modelObjectKey,
  queryKind,
  sourceObjectKey,
  TestDatabase as SharedTestDatabase,
  type TestDatabaseOptions,
} from './document-route.test-support'

const fixture = await readFile('../../data/evals/redact/demo-fixture.docx')
export const cachedModelJson = serialiseModelJson(await parseDocx(fixture))

export { expectDocument404, modelObjectKey, queryKind, sourceObjectKey }

export class TestDatabase extends SharedTestDatabase {
  constructor(options: TestDatabaseOptions = {}) {
    super({
      filename: 'private.docx',
      sizeBytes: String(fixture.byteLength),
      ...options,
    })
  }
}

export class MemoryStorage extends SharedMemoryStorage {
  constructor() {
    super({ binary: [[sourceObjectKey, fixture]] })
  }
}

export function routeApp(
  database: TestDatabase,
  storage: MemoryStorage,
  user: AuthzUser | null = {
    id: 'usr_viewer',
    organisationId: 'org_1',
    role: 'member',
  },
) {
  return createRouteApp({
    database,
    storage,
    user,
    requestId: 'req_model',
    createRoutes: createDocumentModelRoutes,
  })
}
