import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Pool } from 'pg'
import type {
  ApiErrorCode,
  ApiErrorResponse,
  UserRole,
} from '@obiter/contracts'
import {
  appendAuditLog,
  createDocument,
  getDocument,
  updateDocumentExtraction,
  getMatter,
  listDocuments,
  restoreDocumentWithAudit,
  softDeleteDocumentWithCascade,
} from '../database'
import {
  DocumentExtractionError,
  extractDocumentContent,
  normaliseFileType,
} from '../document-extraction'
import { DocumentUploadError, readDocumentUpload } from '../document-upload'
import {
  readLimitedFormData,
  readLimitedJsonBody,
} from '../limited-request-body'
import {
  DEFAULT_API_REQUEST_LIMITS,
  type ApiRequestLimits,
} from '../request-limits'
import type { StorageService } from '../storage'
import { ensureOrgUser, requireManageRole } from '../authz'

interface RouteUser {
  id: string
  organisationId?: string | null
  role?: UserRole | null
}

interface RouteVariables {
  requestId: string
  user: RouteUser | null
}

type RouteContext = Context<{ Variables: RouteVariables }>

function errorResponse(
  c: RouteContext,
  code: ApiErrorCode,
  message: string,
  status: 400 | 401 | 403 | 404 | 413,
) {
  const body: ApiErrorResponse = {
    error: { code, message, requestId: c.get('requestId') },
  }
  return c.json(body, status)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function requiredInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

export { MAX_DOCUMENT_UPLOAD_BYTES } from '../document-upload'

export function createDocumentsRoutes(
  pool: Pool,
  storage?: StorageService,
  limits: ApiRequestLimits = DEFAULT_API_REQUEST_LIMITS,
) {
  const routes = new Hono<{ Variables: RouteVariables }>()

  routes.post('/api/matters/:matterId/documents', async (c) => {
    const user = await ensureOrgUser(c, pool)
    if (user instanceof Response) return user

    const matterId = c.req.param('matterId')
    const matter = await getMatter(pool, user, matterId, 'edit')
    if (!matter)
      return errorResponse(c, 'matter_not_found', 'Matter not found.', 404)

    const isMultipart =
      c.req
        .header('content-type')
        ?.toLowerCase()
        .startsWith('multipart/form-data') ?? false
    let form: FormData | null = null
    if (isMultipart) {
      const formResult = await readLimitedFormData(
        c,
        limits.documentUploadMaxBytes,
      )
      if (!formResult.ok) return formResult.response
      form = formResult.form
    }
    const body = form
      ? null
      : await readLimitedJsonBody(c, limits.jsonBodyMaxBytes)
    if (body instanceof Response) return body
    const upload = form?.get('file')
    const file = upload instanceof File ? upload : null
    const bodyRecord = body ? asRecord(body) : null
    const filename =
      file?.name ||
      requiredString(form?.get('filename')) ||
      requiredString(bodyRecord?.filename)
    const fileType =
      requiredString(form?.get('fileType')) ||
      requiredString(bodyRecord?.fileType) ||
      file?.type ||
      null
    const contentSha256 =
      requiredString(form?.get('contentSha256')) ||
      requiredString(bodyRecord?.contentSha256)
    const sizeBytes =
      file?.size ??
      requiredInteger(form?.get('sizeBytes')) ??
      requiredInteger(bodyRecord?.sizeBytes)

    if (
      !filename ||
      !fileType ||
      (!file && !contentSha256) ||
      sizeBytes === null
    ) {
      return errorResponse(
        c,
        'validation_failed',
        'Document upload metadata is required.',
        400,
      )
    }
    const supportedType = normaliseFileType(fileType)
    if (file && !storage?.writeBinary)
      return errorResponse(
        c,
        'storage_unavailable',
        'Document storage is unavailable.',
        400,
      )

    let uploadContents: Buffer | null = null
    let verifiedType = supportedType
    let verifiedHash = contentSha256
    if (file) {
      let upload: Awaited<ReturnType<typeof readDocumentUpload>>
      try {
        upload = await readDocumentUpload(
          file,
          fileType,
          limits.documentUploadMaxBytes,
        )
      } catch (error) {
        if (error instanceof DocumentUploadError)
          return errorResponse(c, 'validation_failed', error.message, 400)
        throw error
      }
      uploadContents = upload.contents
      verifiedType = upload.fileType
      const computedHash = createHash('sha256')
        .update(uploadContents)
        .digest('hex')
      if (contentSha256 && contentSha256.toLowerCase() !== computedHash)
        return errorResponse(
          c,
          'validation_failed',
          'The supplied content SHA-256 does not match the uploaded file.',
          400,
        )
      verifiedHash = computedHash
    }

    const result = await createDocument(pool, {
      organisationId: user.organisationId,
      matterId,
      userId: user.id,
      filename,
      fileType: verifiedType ?? fileType,
      sizeBytes: uploadContents?.byteLength ?? sizeBytes,
      contentSha256: verifiedHash!,
    })
    if (!result) {
      return errorResponse(c, 'matter_not_found', 'Matter not found.', 404)
    }

    if (uploadContents && verifiedType && storage?.writeBinary) {
      const markExtractionFailed = async (failureReason: string) => {
        try {
          const version = await updateDocumentExtraction(pool, {
            organisationId: user.organisationId,
            versionId: result.version.id,
            failureReason,
          })
          if (version) result.version = version
        } catch {
          // Preserve the original storage failure response.
        }
      }
      const textObjectKey = result.version.objectKey.replace(
        /\/source$/,
        '/text',
      )
      try {
        await storage.writeBinary(result.version.objectKey, uploadContents)
      } catch {
        await markExtractionFailed('Document storage write failed.')
        return errorResponse(
          c,
          'storage_unavailable',
          'Document storage is unavailable.',
          400,
        )
      }
      try {
        const extracted = await extractDocumentContent(
          verifiedType,
          uploadContents,
          { ooxmlLimits: limits.ooxmlLimits },
        )
        await storage.writeText(textObjectKey, extracted.text)
        if (extracted.layout) {
          const layoutObjectKey = result.version.objectKey.replace(
            /\/source$/,
            '/layout.json',
          )
          await storage.writeText(
            layoutObjectKey,
            JSON.stringify(extracted.layout),
          )
        }
        const version = await updateDocumentExtraction(pool, {
          organisationId: user.organisationId,
          versionId: result.version.id,
          textObjectKey,
        })
        if (version) result.version = version
      } catch (error) {
        if (error instanceof DocumentExtractionError) {
          if (
            error.userFacing &&
            error.message.startsWith('The document package')
          ) {
            await markExtractionFailed(error.message)
            return errorResponse(c, 'ooxml_limits_exceeded', error.message, 413)
          }
          await markExtractionFailed(
            error.userFacing
              ? error.message
              : 'Document text could not be read.',
          )
        } else {
          await markExtractionFailed('Document storage write failed.')
          return errorResponse(
            c,
            'storage_unavailable',
            'Document storage is unavailable.',
            400,
          )
        }
      }
    }
    await appendAuditLog(pool, {
      organisationId: user.organisationId,
      userId: user.id,
      entityType: 'document',
      entityId: result.document.id,
      action: 'document.upload',
      metadata: { versionId: result.version.id },
      requestId: c.get('requestId'),
    })
    await appendAuditLog(pool, {
      organisationId: user.organisationId,
      userId: user.id,
      entityType: 'document_version',
      entityId: result.version.id,
      action: 'document.version_create',
      metadata: { documentId: result.document.id },
      requestId: c.get('requestId'),
    })

    return c.json(result, 201)
  })

  routes.get('/api/matters/:matterId/documents', async (c) => {
    const user = await ensureOrgUser(c, pool)
    if (user instanceof Response) return user

    const includeDeleted =
      c.req.queries('includeDeleted')?.includes('true') ?? false
    if (includeDeleted) {
      const manageUser = await requireManageRole(c, pool)
      if (manageUser instanceof Response) return manageUser
    }

    const matterId = c.req.param('matterId')
    const matter = await getMatter(pool, user, matterId, 'view')
    if (!matter)
      return errorResponse(c, 'matter_not_found', 'Matter not found.', 404)

    const documents = await listDocuments(pool, user, matterId, {
      includeDeleted,
    })
    return c.json({ documents })
  })

  routes.get('/api/documents/:id', async (c) => {
    const user = await ensureOrgUser(c, pool)
    if (user instanceof Response) return user

    const includeDeleted =
      c.req.queries('includeDeleted')?.includes('true') ?? false
    if (includeDeleted) {
      const manageUser = await requireManageRole(c, pool)
      if (manageUser instanceof Response) return manageUser
    }

    const result = await getDocument(pool, user, c.req.param('id'), 'view', {
      includeDeleted,
    })
    if (!result) {
      return errorResponse(c, 'document_not_found', 'Document not found.', 404)
    }
    return c.json(result)
  })

  routes.delete('/api/documents/:id', async (c) => {
    const user = await requireManageRole(c, pool)
    if (user instanceof Response) return user

    const result = await softDeleteDocumentWithCascade(pool, {
      organisationId: user.organisationId,
      userId: user.id,
      id: c.req.param('id'),
      requestId: c.get('requestId'),
    })
    if (!result) {
      return errorResponse(c, 'document_not_found', 'Document not found.', 404)
    }
    return c.json(result)
  })

  routes.patch('/api/documents/:id/restore', async (c) => {
    const user = await requireManageRole(c, pool)
    if (user instanceof Response) return user

    const result = await restoreDocumentWithAudit(pool, {
      organisationId: user.organisationId,
      userId: user.id,
      id: c.req.param('id'),
      requestId: c.get('requestId'),
    })
    if (!result) {
      return errorResponse(
        c,
        'document_not_found',
        'Deleted document not found.',
        404,
      )
    }
    return c.json(result)
  })

  return routes
}
