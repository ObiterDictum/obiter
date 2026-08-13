import JSZip from 'jszip'
import type { AuthzUser } from '../authz'
import { createDocumentMediaRoutes } from './document-media'
import {
  createRouteApp,
  expectDocument404,
  MemoryStorage as SharedMemoryStorage,
  sourceObjectKey,
  TestDatabase as SharedTestDatabase,
  type TestDatabaseOptions,
} from './document-route.test-support'

const pngBytes = Buffer.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
  0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 215,
  99, 248, 207, 192, 240, 31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73,
  69, 78, 68, 174, 66, 96, 130,
])

export const imagePartName = 'word/media/image1.png'
export const mediaUrl = `/api/documents/doc_1/media?part=${encodeURIComponent(imagePartName)}`

export { expectDocument404, sourceObjectKey }

export class TestDatabase extends SharedTestDatabase {
  constructor(options: TestDatabaseOptions = {}) {
    super({ filename: 'letter.docx', ...options })
  }
}

export class MemoryStorage extends SharedMemoryStorage {
  constructor(source?: Buffer) {
    super({ binary: source ? [[sourceObjectKey, source]] : [] })
  }
}

export async function packageWithImage() {
  const zip = new JSZip()
  zip.file(imagePartName, pngBytes, { binary: true })
  zip.file('word/media/image2.png', pngBytes, { binary: true })
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
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
    requestId: 'req_media',
    createRoutes: createDocumentMediaRoutes,
  })
}

export { pngBytes }
