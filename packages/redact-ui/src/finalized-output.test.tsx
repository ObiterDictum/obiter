import '@obiter/test-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import type { PdfPreviewStatus } from './pdf-document-preview'

const hooks = vi.hoisted(() => ({
  useRedactionRun: vi.fn(),
  useRedactionDocumentText: vi.fn(),
  useRedactionOutput: vi.fn(),
  useRedactionOutputFile: vi.fn(),
  useSpanDecision: vi.fn(() => ({})),
  useFinalizeRun: vi.fn(() => ({})),
  useRedetectRun: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}))

const sourcePreviewHooks = vi.hoisted(() => ({
  useRedactionSource: vi.fn(() => ({
    isPending: false,
    data: undefined,
    isError: false,
  })),
}))

// Capture the Blob handed to the preview so a test can prove the download used
// the exact same artifact bytes rather than refetching different ones.
const preview = vi.hoisted(() => ({
  file: null as Blob | null,
  onStatusChange: null as ((status: PdfPreviewStatus) => void) | null,
  renderCount: 0,
}))

const hooksKeys = Object.fromEntries(
  Object.keys(await import('./hooks')).map((key) => [key, undefined]),
)
mock.module('./hooks', () => Object.assign({ ...hooksKeys }, hooks))
const sourcePreviewKeys = Object.fromEntries(
  Object.keys(await import('./source-preview-hooks')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('./source-preview-hooks', () =>
  Object.assign({ ...sourcePreviewKeys }, sourcePreviewHooks),
)
mock.module('./pdf-document-preview', () => ({
  PdfDocumentPreview: ({
    file,
    onStatusChange,
  }: {
    file: Blob
    onStatusChange?: (status: PdfPreviewStatus) => void
  }) => {
    preview.file = file
    preview.onStatusChange = onStatusChange ?? null
    preview.renderCount += 1
    return <div data-testid="pdf-preview" />
  },
}))

const { RedactionReviewView } = await import('./review')

const onOpenRun = vi.fn()

const baseRun = {
  id: 'red_1',
  matterId: null,
  matterName: null,
  documentId: null,
  documentVersionId: null,
  sourceFilename: 'brief.docx',
  status: 'finalized' as const,
  policyMode: 'internal_ai_minimisation' as const,
  spans: [],
  decisions: {},
  outputArtifactId: 'art_1',
  detectorVersion: null,
  detectionMode: 'model+supplement' as const,
  replacesRunId: null,
  replacementRunId: null,
  createdAt: '2026-07-09T00:00:00.000Z',
  updatedAt: '2026-07-09T00:00:00.000Z',
}

function summary(overrides: Record<string, unknown> = {}) {
  return {
    totalSpans: 0,
    byCategory: {},
    bySource: { rampartModel: 0, rampartDeterministic: 0, ukSupplement: 0 },
    reviewedCount: 0,
    unreviewedCount: 0,
    outputMode: 'redacted' as const,
    outputMimeType: 'application/pdf',
    outputFilename: 'brief-redacted.pdf',
    securePdf: true,
    ...overrides,
  }
}

const artifact = new Blob(['%PDF-artifact-bytes'], {
  type: 'application/pdf',
})

function renderView() {
  return render(<RedactionReviewView runId="red_1" onOpenRun={onOpenRun} />)
}

function setPreview(status: PdfPreviewStatus) {
  act(() => {
    preview.onStatusChange?.(status)
  })
}

beforeEach(() => {
  preview.file = null
  preview.onStatusChange = null
  preview.renderCount = 0
  hooks.useRedactionRun.mockReturnValue({
    isPending: false,
    data: { ...baseRun, summary: summary() },
  })
  hooks.useRedactionDocumentText.mockReturnValue({
    isPending: false,
    data: { text: '' },
  })
  hooks.useRedactionOutput.mockReturnValue({
    isPending: false,
    data: {
      mimeType: 'application/pdf',
      filename: 'brief-redacted.pdf',
      text: null,
      artifactId: 'art_1',
      sha256: 'a'.repeat(64),
      securePdf: true,
    },
  })
  hooks.useRedactionOutputFile.mockReturnValue({
    isPending: false,
    data: artifact,
    error: null,
  })
})

describe('finalized secure redacted PDF output', () => {
  it('shows the secure heading, filename and preview-before-download copy', () => {
    renderView()
    expect(screen.getByText('Secure redacted PDF')).toBeTruthy()
    expect(screen.getAllByText('brief-redacted.pdf').length).toBeGreaterThan(0)
    expect(
      screen.getByText(
        'Preview the finalized file below. Download and share this PDF only after checking every page.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Download secure PDF' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Share secure PDF' }),
    ).toBeTruthy()
  })

  it('keeps the download disabled until the first page has rendered', () => {
    renderView()
    const download = screen.getByRole('button', {
      name: 'Download secure PDF',
    })
    expect(download).toHaveProperty('disabled', true)

    setPreview({ kind: 'ready', pageCount: 3 })
    expect(screen.getByText('Preview ready, 3 pages')).toBeTruthy()
    expect(download).toHaveProperty('disabled', false)
  })

  it('disables the download and shows an inline error when the preview fails', () => {
    renderView()
    setPreview({ kind: 'error', message: 'broken pdf' })
    expect(
      screen.getByRole('button', { name: 'Download secure PDF' }),
    ).toHaveProperty('disabled', true)
    expect(
      screen.getByText(
        /The finalized PDF could not be previewed, so the download is disabled/,
      ),
    ).toBeTruthy()
  })

  it('uses the exact same Blob for preview and download', () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:artifact')
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined)
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    renderView()

    const previewBlob = preview.file
    expect(previewBlob).toBe(artifact)
    setPreview({ kind: 'ready', pageCount: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Download secure PDF' }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    // Identity, not equality: a second fetch would produce a different object.
    expect(createObjectURL.mock.calls[0]?.[0]).toBe(previewBlob)

    createObjectURL.mockRestore()
    revokeObjectURL.mockRestore()
    click.mockRestore()
  })
})

describe('legacy finalized output', () => {
  it('keeps the true DOCX filename and labels it as pre-secure-default', () => {
    hooks.useRedactionRun.mockReturnValue({
      isPending: false,
      data: {
        ...baseRun,
        summary: summary({
          outputMimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          outputFilename: 'brief-redacted.docx',
          securePdf: false,
        }),
      },
    })
    hooks.useRedactionOutput.mockReturnValue({
      isPending: false,
      data: {
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: 'brief-redacted.docx',
        text: null,
        artifactId: 'art_1',
        sha256: null,
        securePdf: false,
      },
    })
    hooks.useRedactionOutputFile.mockReturnValue({
      isPending: false,
      data: new Blob(['docx-bytes'], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      error: null,
    })

    renderView()
    expect(screen.queryByText('Secure redacted PDF')).toBeNull()
    expect(
      screen.getByText('Created before secure PDF became the default output.'),
    ).toBeTruthy()
    expect(screen.getAllByText('brief-redacted.docx').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Download' })).toHaveProperty(
      'disabled',
      false,
    )
  })

  it('shows a pseudonymised run as an editable copy, not a secure PDF', () => {
    hooks.useRedactionRun.mockReturnValue({
      isPending: false,
      data: {
        ...baseRun,
        summary: summary({
          outputMode: 'pseudonymised',
          outputMimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          outputFilename: 'brief-pseudonymised.docx',
          securePdf: false,
        }),
      },
    })
    hooks.useRedactionOutput.mockReturnValue({
      isPending: false,
      data: {
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: 'brief-pseudonymised.docx',
        text: null,
        artifactId: 'art_1',
        sha256: null,
        securePdf: false,
      },
    })
    hooks.useRedactionOutputFile.mockReturnValue({
      isPending: false,
      data: new Blob(['docx-bytes'], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      error: null,
    })

    renderView()
    expect(screen.getByText('Pseudonymised editable copy')).toBeTruthy()
    expect(
      screen.getByText(
        'Replaces accepted content with consistent category tokens for continued internal work. Token-map access remains restricted and audited.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Download editable copy' }),
    ).toHaveProperty('disabled', false)
  })
})
