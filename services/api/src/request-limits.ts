import {
  DEFAULT_OOXML_PACKAGE_LIMITS,
  type OoxmlPackageLimits,
} from '@obiter/ooxml'
import type { ApiEnv } from './env'
import {
  DEFAULT_DOCUMENT_EDIT_MAX_BYTES,
  DEFAULT_DOCUMENT_UPLOAD_MAX_BYTES,
  DEFAULT_JSON_BODY_MAX_BYTES,
} from './request-limit-defaults'

export interface ApiRequestLimits {
  jsonBodyMaxBytes: number
  documentUploadMaxBytes: number
  documentEditMaxBytes: number
  ooxmlLimits: OoxmlPackageLimits
}

export function apiRequestLimitsFromEnv(env: ApiEnv): ApiRequestLimits {
  return {
    jsonBodyMaxBytes: env.jsonBodyMaxBytes,
    documentUploadMaxBytes: env.documentUploadMaxBytes,
    documentEditMaxBytes: env.documentEditMaxBytes,
    ooxmlLimits: {
      maxEntries: env.ooxmlMaxEntries,
      maxUncompressedBytes: env.ooxmlMaxUncompressedBytes,
      maxEntryUncompressedBytes: env.ooxmlMaxEntryUncompressedBytes,
      maxCompressionRatio: env.ooxmlMaxCompressionRatio,
      inflateConcurrency: env.ooxmlInflateConcurrency,
      minRatioCompressedBytes: 256,
    },
  }
}

export const DEFAULT_API_REQUEST_LIMITS: ApiRequestLimits = {
  jsonBodyMaxBytes: DEFAULT_JSON_BODY_MAX_BYTES,
  documentUploadMaxBytes: DEFAULT_DOCUMENT_UPLOAD_MAX_BYTES,
  documentEditMaxBytes: DEFAULT_DOCUMENT_EDIT_MAX_BYTES,
  ooxmlLimits: DEFAULT_OOXML_PACKAGE_LIMITS,
}
