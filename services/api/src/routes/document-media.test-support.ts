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

const jpegBytes = Buffer.from([
  255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 255,
  219, 0, 67, 0, 8, 6, 6, 7, 6, 5, 8, 7, 7, 7, 9, 9, 8, 10, 12, 20, 13, 12, 11,
  11, 12, 25, 18, 19, 15, 20, 29, 26, 31, 30, 29, 26, 28, 28, 32, 36, 46, 39,
  32, 34, 44, 35, 28, 28, 40, 55, 41, 44, 48, 49, 52, 52, 52, 31, 39, 57, 61,
  56, 50, 60, 46, 51, 52, 50, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 255,
  196, 0, 31, 0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4,
  5, 6, 7, 8, 9, 10, 11, 255, 196, 0, 181, 16, 0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4,
  4, 0, 0, 1, 125, 1, 2, 3, 0, 4, 17, 5, 18, 33, 49, 65, 6, 19, 81, 97, 7, 34,
  113, 20, 50, 129, 145, 161, 8, 35, 177, 193, 21, 66, 209, 225, 240, 36, 51,
  67, 82, 98, 114, 130, 9, 10, 22, 38, 52, 68, 84, 100, 116, 132, 149, 165, 181,
  197, 213, 229, 245, 255, 218, 0, 12, 3, 1, 0, 2, 17, 3, 17, 0, 63, 0, 249, 40,
  162, 138, 0, 255, 217,
])

export const svgPartName = 'word/media/image1.svg'
export const jpegPartName = 'word/media/image1.jpeg'

export const scriptedSvgBytes = Buffer.from(
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  'utf8',
)

export function contentDispositionType(header: string | null) {
  if (!header) return null
  const [type] = header.split(';', 1)
  return type.trim().toLowerCase()
}

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

export async function packageWithJpeg() {
  const zip = new JSZip()
  zip.file(jpegPartName, jpegBytes, { binary: true })
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
}

export async function packageWithScriptedSvg() {
  const zip = new JSZip()
  zip.file(svgPartName, scriptedSvgBytes, { binary: true })
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

export { pngBytes, jpegBytes }
