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
  useReturnToDocument: vi.fn(
    (): {
      mutate: ReturnType<typeof vi.fn>
      isPending: boolean
      error?: { message: string } | null
      data?: {
        documentId: string
        versionId: string
        versionNumber: number
      }
    } => ({ mutate: vi.fn(), isPending: false }),
  ),
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
  returnedDocumentVersionId: null,
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

  it('re-locks the download when a new artifact Blob replaces a rendered one', () => {
    const { rerender } = renderView()
    setPreview({ kind: 'ready', pageCount: 1 })
    expect(
      screen.getByRole('button', { name: 'Download secure PDF' }),
    ).toHaveProperty('disabled', false)

    // A refetch hands the view a different Blob; the ready state belonged to
    // the old one and must not enable a download of bytes nobody previewed.
    const replacement = new Blob(['%PDF-replacement'], {
      type: 'application/pdf',
    })
    hooks.useRedactionOutputFile.mockReturnValue({
      isPending: false,
      data: replacement,
      error: null,
    })
    rerender(<RedactionReviewView runId="red_1" onOpenRun={onOpenRun} />)
    expect(
      screen.getByRole('button', { name: 'Download secure PDF' }),
    ).toHaveProperty('disabled', true)
    expect(screen.queryByText('Preview ready, 1 page')).toBeNull()

    setPreview({ kind: 'ready', pageCount: 1 })
    expect(
      screen.getByRole('button', { name: 'Download secure PDF' }),
    ).toHaveProperty('disabled', false)
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

describe('return to document', () => {
  const docxOutput = {
    outputMimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    outputFilename: 'brief-redacted.docx',
    securePdf: false,
  }

  function documentBoundRun(overrides: Record<string, unknown> = {}) {
    return {
      ...baseRun,
      documentId: 'doc_1',
      documentVersionId: 'ver_1',
      summary: summary(docxOutput),
      ...overrides,
    }
  }

  beforeEach(() => {
    hooks.useRedactionOutput.mockReturnValue({
      isPending: false,
      data: {
        // mimeType intentionally absent: the view falls back to
        // summary.outputMimeType, which each case controls.
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
  })

  it('sends the version the run redacted as the stale base', () => {
    const mutate = vi.fn()
    hooks.useReturnToDocument.mockReturnValue({
      mutate,
      isPending: false,
      error: null,
    })
    hooks.useRedactionRun.mockReturnValue({
      isPending: false,
      data: documentBoundRun(),
    })

    renderView()
    fireEvent.click(screen.getByRole('button', { name: 'Return to document' }))
    expect(mutate).toHaveBeenCalledWith({ baseVersionId: 'ver_1' })
  })

  it('shows the returned badge and an open-document path once returned', () => {
    const onOpenDocument = vi.fn()
    hooks.useReturnToDocument.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: null,
      data: { documentId: 'doc_1', versionId: 'ver_9', versionNumber: 9 },
    })
    hooks.useRedactionRun.mockReturnValue({
      isPending: false,
      data: documentBoundRun({ returnedDocumentVersionId: 'ver_9' }),
    })

    render(
      <RedactionReviewView
        runId="red_1"
        onOpenRun={onOpenRun}
        onOpenDocument={onOpenDocument}
      />,
    )
    expect(screen.getByText('Returned to document')).toBeTruthy()
    expect(screen.getByText(/Saved as version 9 of the/)).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Return to document' }),
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open document' }))
    expect(onOpenDocument).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc_1' }),
    )
  })

  it('surfaces a stale-head refusal instead of pretending the return landed', () => {
    hooks.useReturnToDocument.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: {
        message:
          'The document changed after this run redacted it. Reload the document before returning the output.',
      },
    })
    hooks.useRedactionRun.mockReturnValue({
      isPending: false,
      data: documentBoundRun(),
    })

    renderView()
    expect(screen.getByRole('alert').textContent).toContain(
      'document changed after this run redacted it',
    )
  })

  it('never offers the return for non-document, non-DOCX or superseded runs', () => {
    // No document link; secure-PDF output; a superseded run whose decisions no
    // longer describe the source. None may offer the handoff.
    for (const data of [
      { ...baseRun, summary: summary(docxOutput) },
      {
        ...baseRun,
        documentId: 'doc_1',
        documentVersionId: 'ver_1',
        summary: summary(),
      },
      {
        ...baseRun,
        documentId: 'doc_1',
        documentVersionId: 'ver_1',
        replacementRunId: 'red_2',
        summary: summary(docxOutput),
      },
    ]) {
      hooks.useRedactionRun.mockReturnValue({ isPending: false, data })
      const { unmount } = renderView()
      expect(
        screen.queryByRole('button', { name: 'Return to document' }),
      ).toBeNull()
      unmount()
    }
  })
})
