import type { AuthzUser } from '../authz'
import { createDocumentContentRoutes } from './document-content'
import {
  createRouteApp,
  expectDocument404,
  MemoryStorage as SharedMemoryStorage,
  sourceObjectKey,
  type TestDatabaseOptions,
  TestDatabase as SharedTestDatabase,
  textObjectKey,
} from './document-route.test-support'

export { expectDocument404, sourceObjectKey, textObjectKey }

export const docxBytes = Buffer.from('PK\x03\x04fake-docx-bytes')
export const pdfBytes = Buffer.from('%PDF-1.4 fake-pdf-bytes')
export const txtBytes = Buffer.from('Plain retrieval text.\n')
export const txtExtracted = 'Plain retrieval text.\n'

export class TestDatabase extends SharedTestDatabase {
  constructor(options: TestDatabaseOptions = {}) {
    super({ filename: 'document.bin', ...options })
  }
}

export class MemoryStorage extends SharedMemoryStorage {
  constructor(
    options: {
      binary?: Buffer
      text?: string | null
    } = {},
  ) {
    super({
      binary: [[sourceObjectKey, options.binary ?? txtBytes]],
      text:
        options.text === null
          ? []
          : [[textObjectKey, options.text ?? txtExtracted]],
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
    requestId: 'req_content',
    createRoutes: createDocumentContentRoutes,
  })
}
