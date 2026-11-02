import '@obiter/test-dom'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'bun:test'
import type {
  DocumentVersionRecord,
  MatterDocumentRecord,
} from '../../documents'
import { DocumentInfoPanel } from './document-info-panel'

afterEach(cleanup)

const document: MatterDocumentRecord = {
  id: 'doc_1',
  organisationId: 'org_1',
  matterId: 'mtr_1',
  currentVersionId: 'ver_2',
  logicalKey: 'synthetic.docx',
  createdBy: 'usr_1',
  createdAt: '2026-11-02T10:00:00.000Z',
  updatedAt: '2026-11-02T11:00:00.000Z',
  deletedAt: null,
  deletedBy: null,
}

function version(
  overrides: Partial<DocumentVersionRecord> = {},
): DocumentVersionRecord {
  return {
    id: 'ver_2',
    organisationId: 'org_1',
    matterId: 'mtr_1',
    matterDocumentId: 'doc_1',
    filename: 'synthetic.docx',
    fileType: 'docx',
    sizeBytes: '2048',
    objectKey: 'org_1/matters/mtr_1/documents/doc_1/versions/ver_2/source',
    textObjectKey: null,
    documentStatus: 'ready',
    failureReason: null,
    versionNumber: 2,
    contentSha256: 'a'.repeat(64),
    syncState: 'synced',
    createdBy: 'usr_1',
    createdAt: '2026-11-02T11:00:00.000Z',
    updatedAt: '2026-11-02T11:00:00.000Z',
    ...overrides,
  }
}

function mountPanel(versions: DocumentVersionRecord[]) {
  render(
    <DocumentInfoPanel
      open
      onClose={() => {}}
      document={document}
      versions={versions}
    />,
  )
}

describe('version history authors', () => {
  it('shows who saved each version without a marker for a current member', () => {
    mountPanel([
      version({
        author: { id: 'usr_1', name: 'Alex Morgan', formerMember: false },
      }),
    ])

    expect(screen.getByText('Alex Morgan').textContent).toBe('Alex Morgan')
  })

  it('marks the author of a version saved by someone who has left the firm', () => {
    mountPanel([
      version({
        author: { id: 'usr_1', name: 'Alex Morgan', formerMember: true },
      }),
    ])

    expect(screen.getByText('Alex Morgan').textContent).toBe(
      'Alex Morgan (former member)',
    )
  })

  it('keeps a version from before author attribution in the list without a marker', () => {
    mountPanel([version()])

    expect(screen.getByText(/^Version 2/u)).toBeTruthy()
    expect(screen.queryByText(/former member/u)).toBeNull()
  })
})
