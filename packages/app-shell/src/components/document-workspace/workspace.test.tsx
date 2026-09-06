// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentWorkspace } from './workspace'
import type { DocumentVersionRecord } from '../../documents'

const workspaceApi = vi.hoisted(() => ({
  fetchDocumentDownload: vi.fn(),
  useDocumentPdfView: vi.fn(),
  useDocumentText: vi.fn(),
}))

vi.mock('../../document-workspace-api', () => workspaceApi)

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
    workspaceApi.useDocumentPdfView.mockReturnValue({
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
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy()
  })

  it('omits the page heading when opened in the matter pane', () => {
    workspaceApi.useDocumentPdfView.mockReturnValue({
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

  it('renders the extracted text for a ready txt version', () => {
    workspaceApi.useDocumentText.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        documentId: 'doc_1',
        versionId: 'ver_1',
        versionNumber: 1,
        text: 'Plain retrieval text.',
      },
    })
    render(
      <DocumentWorkspace
        documentId="doc_1"
        version={version({ filename: 'notes.txt', fileType: 'txt' })}
      />,
    )
    expect(screen.getByText('Plain retrieval text.')).toBeTruthy()
    expect(screen.getByText('Plain text, not editable')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy()
  })

  it('surfaces a rejected download as a status message in the text viewer', async () => {
    workspaceApi.useDocumentText.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        documentId: 'doc_1',
        versionId: 'ver_1',
        versionNumber: 1,
        text: 'Plain retrieval text.',
      },
    })
    workspaceApi.fetchDocumentDownload.mockRejectedValue(
      new Error('Download failed.'),
    )
    render(
      <DocumentWorkspace
        documentId="doc_1"
        version={version({ filename: 'notes.txt', fileType: 'txt' })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    const status = await screen.findByRole('status')
    expect(status.textContent).toBe('Download failed.')
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

  it('shows the stored failure reason in full when extraction failed', () => {
    render(
      <DocumentWorkspace
        documentId="doc_1"
        version={version({
          documentStatus: 'failed',
          failureReason:
            'This PDF appears to be scanned — text extraction requires OCR, which is not yet supported.',
        })}
      />,
    )
    expect(screen.getByText('This document could not be opened')).toBeTruthy()
    expect(
      screen.getByText(
        'This PDF appears to be scanned — text extraction requires OCR, which is not yet supported.',
      ),
    ).toBeTruthy()
  })

  it('falls back to a generic message when a failed version has no reason', () => {
    render(
      <DocumentWorkspace
        documentId="doc_1"
        version={version({ documentStatus: 'failed' })}
      />,
    )
    expect(
      screen.getByText(
        'The document text could not be read. Try uploading it again.',
      ),
    ).toBeTruthy()
  })

  it('offers a download instead of a dead end for an unsupported type', () => {
    render(
      <DocumentWorkspace
        documentId="doc_1"
        version={version({ fileType: 'odt', filename: 'legacy.odt' })}
      />,
    )
    expect(
      screen.getByText('No in-product viewer for this file type'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy()
  })
})
