// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentWorkspace } from './workspace'
import type { DocumentVersionRecord } from '../../documents'

const pdf = vi.hoisted(() => ({ useDocumentPdfView: vi.fn() }))

vi.mock('../../document-workspace-api', () => ({
  useDocumentPdfView: pdf.useDocumentPdfView,
}))

vi.mock('./docx-workspace', () => ({
  DocxWorkspace: () => <div>Word workspace</div>,
}))

function version(
  overrides: Partial<DocumentVersionRecord> = {},
): DocumentVersionRecord {
  return {
    id: 'ver_1',
    organisationId: 'org_1',
    matterId: 'mtr_1',
    matterDocumentId: 'doc_1',
    filename: 'brief.docx',
    fileType: 'docx',
    sizeBytes: '1024',
    objectKey: 'org/org_1/matters/mtr_1/documents/doc_1/versions/ver_1/source',
    textObjectKey: null,
    documentStatus: 'ready',
    failureReason: null,
    versionNumber: 1,
    contentSha256: 'a'.repeat(64),
    syncState: 'synced',
    createdBy: 'usr_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DocumentWorkspace', () => {
  it('opens the Word workspace for a ready docx version', () => {
    render(<DocumentWorkspace documentId="doc_1" version={version()} />)
    expect(screen.getByText('Word workspace')).toBeTruthy()
  })

  it('opens the PDF layout view for a ready pdf version', () => {
    pdf.useDocumentPdfView.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        documentId: 'doc_1',
        versionId: 'ver_1',
        versionNumber: 1,
        text: 'Judgment text',
        layout: {
          version: 1,
          pages: [{ width: 200, height: 200 }],
          segments: [
            {
              start: 0,
              end: 13,
              pageIndex: 0,
              x: 10,
              y: 180,
              width: 80,
              height: 12,
            },
          ],
        },
      },
    })
    render(
      <DocumentWorkspace
        documentId="doc_1"
        version={version({ filename: 'bundle.pdf', fileType: 'pdf' })}
      />,
    )
    expect(screen.getByText('View only, not editable')).toBeTruthy()
    expect(screen.getByText('Judgment text')).toBeTruthy()
  })

  it('omits the page heading when opened in the matter pane', () => {
    pdf.useDocumentPdfView.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        documentId: 'doc_1',
        versionId: 'ver_1',
        versionNumber: 1,
        text: 'Judgment text',
        layout: {
          version: 1,
          pages: [{ width: 200, height: 200 }],
          segments: [],
        },
      },
    })
    render(
      <DocumentWorkspace
        documentId="doc_1"
        version={version({ filename: 'bundle.pdf', fileType: 'pdf' })}
        layout="pane"
      />,
    )
    expect(screen.queryByRole('heading', { name: 'Document' })).toBeNull()
    expect(screen.getByText('View only, not editable')).toBeTruthy()
  })

  it('explains when the version is not ready', () => {
    render(
      <DocumentWorkspace
        documentId="doc_1"
        version={version({ documentStatus: 'processing' })}
      />,
    )
    expect(screen.getByText('Document is not ready to open')).toBeTruthy()
  })

  it('explains when the file type has no workspace', () => {
    render(
      <DocumentWorkspace
        documentId="doc_1"
        version={version({ fileType: 'txt', filename: 'notes.txt' })}
      />,
    )
    expect(
      screen.getByText('No in-product viewer for this file type'),
    ).toBeTruthy()
  })
})
