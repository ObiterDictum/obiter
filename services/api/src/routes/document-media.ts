import { Hono } from 'hono'
import type { Pool } from 'pg'
import { isPackageImagePartName } from '@obiter/ooxml'
import type { AuthzVariables } from '../authz'
import {
  getDocumentImagePart,
  createDocumentImagePartCache,
} from '../document-media-store'
import type { StorageService } from '../storage'
import {
  documentNotFound,
  resolveCurrentReadyDocumentVersion,
} from './document-route-shared'

export function createDocumentMediaRoutes(pool: Pool, storage: StorageService) {
  const routes = new Hono<{ Variables: AuthzVariables }>()
  const imageParts = createDocumentImagePartCache()

  routes.get('/api/documents/:id/media', async (c) => {
    const resolved = await resolveCurrentReadyDocumentVersion(
      c,
      pool,
      c.req.param('id'),
      'docx',
    )
    if (resolved instanceof Response) return resolved

    const partName = c.req.query('part') ?? ''
    if (!isPackageImagePartName(partName)) return documentNotFound(c)

    const part = await getDocumentImagePart(
      storage,
      resolved.version,
      partName,
      imageParts,
    )
    if (!part) return documentNotFound(c)

    return new Response(Uint8Array.from(part.bytes), {
      status: 200,
      headers: {
        'content-type': part.contentType,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  })

  return routes
}
