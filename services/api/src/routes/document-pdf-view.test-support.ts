import type { AuthzUser } from '../authz'
import { createDocumentPdfViewRoutes } from './document-pdf-view'
import {
  createRouteApp,
  expectDocument404,
  layoutObjectKey,
  MemoryStorage as SharedMemoryStorage,
  sourceObjectKey,
  TestDatabase as SharedTestDatabase,
  type TestDatabaseOptions,
  textObjectKey,
} from './document-route.test-support'

export { expectDocument404, layoutObjectKey, sourceObjectKey, textObjectKey }
export const extractedText = 'Alpha'
export const layout = {
  version: 1 as const,
  pages: [{ width: 612, height: 792 }],
  segments: [
    {
      start: 0,
      end: 5,
      pageIndex: 0,
      x: 72,
      y: 720,
      width: 30,
      height: 12,
    },
  ],
}

export class TestDatabase extends SharedTestDatabase {
  constructor(options: TestDatabaseOptions = {}) {
    super({ filename: 'document.pdf', fileType: 'pdf', ...options })
  }
}

export class MemoryStorage extends SharedMemoryStorage {
  constructor() {
    super({
      text: [
        [textObjectKey, extractedText],
        [layoutObjectKey, JSON.stringify(layout)],
      ],
    })
  }
}

export function routeApp(
  database: TestDatabase,
  storage: MemoryStorage,
  user: AuthzUser | null = {
    id: 'usr_reader',
    organisationId: 'org_1',
    role: 'member',
  },
) {
  return createRouteApp({
    database,
    storage,
    user,
    requestId: 'req_pdf_view',
    createRoutes: createDocumentPdfViewRoutes,
  })
}
