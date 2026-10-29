import { command } from './editor-test-commands'

import '@obiter/test-dom'
import { createElement, type PropsWithChildren } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'

import type { DocumentVersionRecord } from '../../documents'

const workspaceApi = vi.hoisted(() => ({
  fetchDocumentDownload: vi.fn(),
  useDocumentPdfView: vi.fn(),
  useDocumentText: vi.fn(),
}))

const documentWorkspaceApiModule = {
  ...(await import('../../document-workspace-api')),
}
const documentWorkspaceApiModuleKeys = Object.fromEntries(
  Object.keys(await import('../../document-workspace-api')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('../../document-workspace-api', () =>
  Object.assign(
    { ...documentWorkspaceApiModuleKeys },
    (() => {
      const actual = documentWorkspaceApiModule
      return { ...actual, ...workspaceApi }
    })(),
  ),
)

const docxWorkspaceModuleKeys = Object.fromEntries(
  Object.keys(await import('./docx-workspace')).map((key) => [key, undefined]),
)
mock.module('./docx-workspace', () =>
  Object.assign(
    { ...docxWorkspaceModuleKeys },
    (() => ({
      DocxWorkspace: () => <div>Word workspace</div>,
    }))(),
  ),
)

const verification = vi.hoisted(() => ({
  useDocument: vi.fn(),
  useDocumentVerificationRuns: vi.fn(),
  useCreateVerificationRun: vi.fn(),
  useVerificationFindings: vi.fn(),
  latestVerificationRun: vi.fn(),
}))
const documentsModule = { ...(await import('../../documents')) }
const documentsModuleKeys = Object.fromEntries(
  Object.keys(await import('../../documents')).map((key) => [key, undefined]),
)
mock.module('../../documents', () =>
  Object.assign(
    { ...documentsModuleKeys },
    (() => {
      const actual = documentsModule
      return { ...actual, useDocument: verification.useDocument }
    })(),
  ),
)
const verificationRunsModule = { ...(await import('../../verification-runs')) }
const verificationRunsModuleKeys = Object.fromEntries(
  Object.keys(await import('../../verification-runs')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('../../verification-runs', () =>
  Object.assign(
    { ...verificationRunsModuleKeys },
    (() => {
      const actual = verificationRunsModule
      return {
        ...actual,
        useDocumentVerificationRuns: verification.useDocumentVerificationRuns,
        useCreateVerificationRun: verification.useCreateVerificationRun,
        useVerificationFindings: verification.useVerificationFindings,
        latestVerificationRun: verification.latestVerificationRun,
      }
    })(),
  ),
)

const { DocumentWorkspace } = await import('./workspace')

function wrapper({ children }: PropsWithChildren) {
  return createElement(
    QueryClientProvider,
    {
      client: new QueryClient({
        defaultOptions: { queries: { retry: false } },
      }),
    },
    children,
  )
}

function renderWorkspace(element: React.ReactElement) {
  return render(element, { wrapper })
}

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

beforeEach(() => {
  verification.useDocument.mockReturnValue({
    isPending: false,
    isError: false,
    data: {
      document: { currentVersion: { id: 'ver_1', documentStatus: 'ready' } },
    },
  })
  verification.useDocumentVerificationRuns.mockReturnValue({
    isPending: false,
    isError: false,
    data: { runs: [] },
  })
  verification.useCreateVerificationRun.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  })
  verification.useVerificationFindings.mockReturnValue({
    isPending: false,
    isError: false,
    findings: [],
  })
  verification.latestVerificationRun.mockReturnValue(null)
})

describe('DocumentWorkspace', () => {
  it('opens the Word workspace for a ready docx version', () => {
    renderWorkspace(
      <DocumentWorkspace documentId="doc_1" version={version()} />,
    )
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
    renderWorkspace(
      <DocumentWorkspace
        documentId="doc_1"
        version={version({ filename: 'bundle.pdf', fileType: 'pdf' })}
      />,
    )
    expect(screen.getByText('View only, not editable')).toBeTruthy()
    expect(screen.getByText('Judgment text')).toBeTruthy()
    expect(command('Download')).toBeTruthy()
  })

  it('routes the find chord from document-body focus, and only while mounted', () => {
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
    const { unmount } = renderWorkspace(
      <DocumentWorkspace
        documentId="doc_1"
        version={version({ filename: 'bundle.pdf', fileType: 'pdf' })}
      />,
    )
    const field = screen.getByLabelText('Find in document')

    expect(fireEvent.keyDown(document.body, { key: 'f', ctrlKey: true })).toBe(
      false,
    )
    expect(document.activeElement).toBe(field)

    field.blur()
    const outside = document.body.appendChild(document.createElement('button'))
    expect(fireEvent.keyDown(outside, { key: 'f', ctrlKey: true })).toBe(true)
    expect(document.activeElement).not.toBe(field)

    unmount()
    expect(fireEvent.keyDown(document.body, { key: 'f', ctrlKey: true })).toBe(
      true,
    )
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
    renderWorkspace(
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
    renderWorkspace(
      <DocumentWorkspace
        documentId="doc_1"
        version={version({ filename: 'notes.txt', fileType: 'txt' })}
      />,
    )
    expect(screen.getByText('Plain retrieval text.')).toBeTruthy()
    expect(screen.getByText('Plain text, not editable')).toBeTruthy()
    expect(command('Download')).toBeTruthy()
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
    renderWorkspace(
      <DocumentWorkspace
        documentId="doc_1"
        version={version({ filename: 'notes.txt', fileType: 'txt' })}
      />,
    )
    fireEvent.click(command('Download'))
    const status = await screen.findByText('Download failed.')
    expect(status.closest('[role="status"]')).toBeTruthy()
  })

  it('explains when the version is not ready', () => {
    renderWorkspace(
      <DocumentWorkspace
        documentId="doc_1"
        version={version({ documentStatus: 'processing' })}
      />,
    )
    expect(screen.getByText('Document is not ready to open')).toBeTruthy()
  })

  it('shows the stored failure reason in full when extraction failed', () => {
    renderWorkspace(
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
    renderWorkspace(
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
    renderWorkspace(
      <DocumentWorkspace
        documentId="doc_1"
        version={version({ fileType: 'odt', filename: 'legacy.odt' })}
      />,
    )
    expect(
      screen.getByText('No in-product viewer for this file type'),
    ).toBeTruthy()
    expect(command('Download')).toBeTruthy()
  })
})
