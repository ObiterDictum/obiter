import { describe, expect, it } from 'vitest'
import {
  createDocumentMetadataResponseSchema,
  listMatterDocumentsResponseSchema,
} from './index'

const version = {
  id: 'ver_1',
  organisationId: 'org_1',
  matterId: 'mtr_1',
  matterDocumentId: 'doc_1',
  filename: 'skeleton-argument.pdf',
  fileType: 'application/pdf',
  sizeBytes: 2048,
  objectKey: 'org/org_1/matters/mtr_1/documents/doc_1/versions/ver_1/source',
  textObjectKey: null,
  documentStatus: 'queued',
  failureReason: null,
  versionNumber: 1,
  contentSha256: 'a'.repeat(64),
  syncState: 'synced',
  createdBy: 'usr_1',
  createdAt: '2026-05-22T18:00:00.000Z',
  updatedAt: '2026-05-22T18:00:00.000Z',
}

const document = {
  id: 'doc_1',
  organisationId: 'org_1',
  matterId: 'mtr_1',
  currentVersionId: 'ver_1',
  logicalKey: 'doc_1',
  createdBy: 'usr_1',
  createdAt: '2026-05-22T18:00:00.000Z',
  updatedAt: '2026-05-22T18:00:00.000Z',
  deletedAt: null,
  currentVersion: version,
}

describe('document contracts', () => {
  it('parses document metadata creation responses with immutable version metadata', () => {
    const parsed = createDocumentMetadataResponseSchema.parse({
      document,
      version,
    })

    expect(parsed.document.currentVersionId).toBe('ver_1')
    expect(parsed.version.versionNumber).toBe(1)
    expect(parsed.version.contentSha256).toBe('a'.repeat(64))
  })

  it('parses matter document lists with nested current version metadata', () => {
    const parsed = listMatterDocumentsResponseSchema.parse({
      documents: [document],
    })

    expect(parsed.documents[0].currentVersion?.filename).toBe('skeleton-argument.pdf')
    expect(parsed.documents[0].currentVersion?.syncState).toBe('synced')
  })
})
