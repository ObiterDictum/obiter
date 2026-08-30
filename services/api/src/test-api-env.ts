import type { ApiEnv } from './env'
import {
  DEFAULT_DOCUMENT_UPLOAD_MAX_BYTES,
  DEFAULT_JSON_BODY_MAX_BYTES,
  DEFAULT_LEGAL_SEARCH_HYDRATION_PER_CLIENT_MAX,
  DEFAULT_LEGAL_SEARCH_HYDRATION_QUEUE_MAX,
  DEFAULT_LEGAL_SEARCH_HYDRATION_WINDOW_MS,
} from './request-limit-defaults'
import {
  OOXML_INFLATE_CONCURRENCY,
  OOXML_MAX_COMPRESSION_RATIO,
  OOXML_MAX_ENTRIES,
  OOXML_MAX_ENTRY_UNCOMPRESSED_BYTES,
  OOXML_MAX_UNCOMPRESSED_BYTES,
} from '@obiter/ooxml'

export function createTestApiEnv(overrides: Partial<ApiEnv> = {}): ApiEnv {
  return {
    databaseUrl: 'postgres://obiter:obiter@localhost:5432/obiter',
    authSecret: 'dev-only-better-auth-secret',
    authBaseUrl: 'http://localhost:8787',
    webOrigin: 'http://localhost:3000',
    marketingOrigin: null,
    desktopOrigin: 'obiter://desktop-auth',
    resendApiKey: null,
    emailFrom: 'onboarding@resend.dev',
    meilisearchHost: 'http://localhost:7700',
    meilisearchSearchApiKey: 'dev-key',
    meilisearchAdminApiKey: 'dev-key',
    legalAuthoritiesIndex: 'legal_authorities',
    mojFindCaseLawBaseUrl: 'https://caselaw.nationalarchives.gov.uk',
    mojFindCaseLawRateLimit: 1000,
    rampartModel: 'qarlus/rampart',
    rampartRevision: 'c3221c5cd838eb69a249ab40f8b442483865f233',
    rampartCacheDir: '/tmp/rampart-cache',
    rampartMinScore: 0.4,
    rampartChunkTokens: 400,
    jsonBodyMaxBytes: DEFAULT_JSON_BODY_MAX_BYTES,
    documentUploadMaxBytes: DEFAULT_DOCUMENT_UPLOAD_MAX_BYTES,
    ooxmlMaxEntries: OOXML_MAX_ENTRIES,
    ooxmlMaxUncompressedBytes: OOXML_MAX_UNCOMPRESSED_BYTES,
    ooxmlMaxEntryUncompressedBytes: OOXML_MAX_ENTRY_UNCOMPRESSED_BYTES,
    ooxmlMaxCompressionRatio: OOXML_MAX_COMPRESSION_RATIO,
    ooxmlInflateConcurrency: OOXML_INFLATE_CONCURRENCY,
    legalSearchHydrationQueueMax: DEFAULT_LEGAL_SEARCH_HYDRATION_QUEUE_MAX,
    legalSearchHydrationPerClientMax:
      DEFAULT_LEGAL_SEARCH_HYDRATION_PER_CLIENT_MAX,
    legalSearchHydrationWindowMs: DEFAULT_LEGAL_SEARCH_HYDRATION_WINDOW_MS,
    port: 8787,
    nodeEnv: 'test',
    ...overrides,
  }
}
