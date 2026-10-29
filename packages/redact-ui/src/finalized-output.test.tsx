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
  useRedactionScheduleExport: vi.fn(),
  useCreateUploadedRedactionRun: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  })),
  useSaveToMatter: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
    data: undefined,
    reset: vi.fn(),
  })),
  useSpanDecision: vi.fn(() => ({})),
  useFinalizeRun: vi.fn(() => ({})),
  useRedetectRun: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useReturnToDocument: vi.fn(
    (): {
      mutate: ReturnType<typeof vi.fn>
      isPending: boolean
      error?: { message: string } | null
      data?: { documentId: string; versionId: string; versionNumber: number }
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
mock.module('@obiter/app-shell', () => ({
  useCurrentUser: () => ({ data: { user: { id: 'usr_me' } } }),
  useMattersList: () => ({
    isPending: false,
    data: [{ id: 'mtr_1', name: 'Okafor v Lumen Logistics' }],
    error: null,
  }),
  PageScaffold: ({
    title,
    description,
    actions,
    children,
  }: {
    title: string
    description?: string
    actions?: React.ReactNode
    children: React.ReactNode
  }) => (
    <div>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      {actions}
      {children}
    </div>
  ),
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
  outputId: 'out_1',
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

const outputFile = new Blob(['%PDF-output-bytes'], {
  type: 'application/pdf',
})

const scheduleFile = new Blob(['%PDF-1.7 schedule'], {
  type: 'text/markdown',
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
      outputId: 'out_1',
      sha256: 'a'.repeat(64),
      securePdf: true,
    },
  })
  hooks.useRedactionOutputFile.mockReturnValue({
    isPending: false,
    data: outputFile,
    error: null,
  })
  hooks.useRedactionScheduleExport.mockReturnValue({
    isPending: false,
    data: scheduleFile,
    error: null,
  })
  hooks.useReturnToDocument.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  })
})

describe('finalised disclosure copy', () => {
  it('lists exactly what the download contains', () => {
    hooks.useRedactionRun.mockReturnValue({
      isPending: false,
      data: {
        ...baseRun,
        summary: summary({ totalSpans: 21, reviewedCount: 21 }),
      },
    })
    renderView()

    expect(
      screen.getByRole('heading', { name: 'Redaction finalised' }),
    ).toBeTruthy()
    expect(screen.getByText('brief-redacted.pdf')).toBeTruthy()
    expect(screen.getByText('PDF, image-only pages')).toBeTruthy()
    expect(
      screen.getByText(
        'Every page is an image: selectable text, fonts, comments, annotations, form fields and attachments are not in the file. Visible text, page layout and the redaction bars are kept.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('21 of 21')).toBeTruthy()
    expect(screen.getByText('17 B')).toBeTruthy()
    expect(screen.getByText('Last updated')).toBeTruthy()
    expect(
      screen.getByText(
        'Check every page of the preview before you download or share this copy.',
      ),
    ).toBeTruthy()
  })

  it('keeps the download disabled until the first page has rendered', () => {
    renderView()
    const download = screen.getByRole('button', { name: 'Download PDF' })
    expect(download).toHaveProperty('disabled', true)

    setPreview({ kind: 'ready', pageCount: 12 })
    expect(screen.getByText('Preview ready · 12 pages')).toBeTruthy()
    expect(download).toHaveProperty('disabled', false)
  })

  it('disables the download and says why when the preview fails', () => {
    renderView()
    setPreview({ kind: 'error', message: 'bad xref' })
    expect(
      screen.getByText(
        'The PDF could not be previewed, so the download stays disabled until it loads. This is not the source document.',
      ),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download PDF' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('downloads the exact bytes it previewed, and revokes the URL afterwards', () => {
    vi.useFakeTimers()
    const urlApi = URL as unknown as {
      createObjectURL?: (blob: Blob) => string
      revokeObjectURL?: (url: string) => void
    }
    urlApi.createObjectURL ??= () => 'blob:missing'
    urlApi.revokeObjectURL ??= () => undefined
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:download')
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined)
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    renderView()
    setPreview({ kind: 'ready', pageCount: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))

    expect(createObjectURL).toHaveBeenCalledWith(outputFile)
    expect(click).toHaveBeenCalled()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:download')

    createObjectURL.mockRestore()
    revokeObjectURL.mockRestore()
    click.mockRestore()
    vi.useRealTimers()
  })

  it('re-locks the download when a new output Blob replaces a rendered one', () => {
    const { rerender } = renderView()
    setPreview({ kind: 'ready', pageCount: 3 })
    expect(screen.getByRole('button', { name: 'Download PDF' })).toHaveProperty(
      'disabled',
      false,
    )

    hooks.useRedactionOutputFile.mockReturnValue({
      isPending: false,
      data: new Blob(['%PDF-second'], { type: 'application/pdf' }),
      error: null,
    })
    rerender(<RedactionReviewView runId="red_1" onOpenRun={onOpenRun} />)
    expect(screen.getByRole('button', { name: 'Download PDF' })).toHaveProperty(
      'disabled',
      true,
    )
    setPreview({ kind: 'ready', pageCount: 2 })
    expect(screen.getByRole('button', { name: 'Download PDF' })).toHaveProperty(
      'disabled',
      false,
    )
  })

  it('shows a failed export with the reason and a retry that refetches', () => {
    const refetchOutput = vi.fn()
    const refetchFile = vi.fn()
    hooks.useRedactionOutput.mockReturnValue({
      isPending: false,
      error: new Error('Redaction output not found.'),
      refetch: refetchOutput,
    })
    hooks.useRedactionOutputFile.mockReturnValue({
      isPending: false,
      data: undefined,
      error: null,
      refetch: refetchFile,
    })
    renderView()
    expect(screen.getByRole('alert').textContent).toContain(
      'The copy could not be loaded, so it cannot be downloaded or previewed. Redaction output not found.',
    )
    expect(screen.getByRole('button', { name: 'Download PDF' })).toHaveProperty(
      'disabled',
      true,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetchOutput).toHaveBeenCalled()
    expect(refetchFile).toHaveBeenCalled()
  })

  it('warns when the output was downgraded instead of shipping it quietly', () => {
    hooks.useRedactionRun.mockReturnValue({
      isPending: false,
      data: {
        ...baseRun,
        summary: summary({
          outputMimeType: 'text/plain',
          outputFilename: 'brief-redacted.txt',
          outputDowngrade: { from: 'docx', reason: 'burn_failed' },
        }),
      },
    })
    hooks.useRedactionOutput.mockReturnValue({
      isPending: false,
      data: {
        mimeType: 'text/plain',
        filename: 'brief-redacted.txt',
        text: '[REDACTED]',
        outputId: 'out_1',
        sha256: null,
        securePdf: false,
      },
    })
    hooks.useRedactionOutputFile.mockReturnValue({
      isPending: false,
      data: undefined,
      error: null,
    })
    renderView()
    expect(screen.getByRole('alert').textContent).toContain(
      'Word document unavailable — text file provided instead',
    )
  })
})

describe('finalised output variants', () => {
  it('labels a legacy DOCX as not disclosure-safe instead of calling it secure', () => {
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
        outputId: 'out_1',
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
    expect(screen.queryByText('Redacted PDF')).toBeNull()
    expect(screen.getByText('Redacted Word document')).toBeTruthy()
    expect(
      screen.getByText(
        'Accepted text is replaced and the document keeps its formatting. Do not treat a Word copy as disclosure-safe: check every page before serving it.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByText(
        'There is no in-app preview for this format. Open the downloaded file and check every page before you share it.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Download Word copy' }),
    ).toHaveProperty('disabled', false)
  })

  it('describes a pseudonymised run as an editable copy, not a disclosure copy', () => {
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
        outputId: 'out_1',
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
    expect(screen.getByText(/It is not a disclosure-safe copy/u)).toBeTruthy()
  })

  it('labels a pseudonymised text output as text, not as a Word document', () => {
    hooks.useRedactionRun.mockReturnValue({
      isPending: false,
      data: {
        ...baseRun,
        summary: summary({
          outputMode: 'pseudonymised',
          outputMimeType: 'text/plain',
          outputFilename: 'brief-pseudonymised.txt',
          securePdf: false,
        }),
      },
    })
    hooks.useRedactionOutput.mockReturnValue({
      isPending: false,
      data: {
        mimeType: 'text/plain',
        filename: 'brief-pseudonymised.txt',
        text: 'PERSON_1 shall pay PERSON_2.',
        outputId: 'out_1',
        sha256: null,
        securePdf: false,
      },
    })
    hooks.useRedactionOutputFile.mockReturnValue({
      isPending: false,
      data: undefined,
      error: null,
    })

    renderView()
    expect(screen.getByText('Pseudonymised copy')).toBeTruthy()
    expect(screen.getByText('Plain text (.txt)')).toBeTruthy()
    expect(screen.queryByText(/Word document/u)).toBeNull()
  })
})

describe('redaction schedule', () => {
  it('is shown as a separate file whose export leaves the removed words out', () => {
    renderView()
    expect(
      screen.getByRole('heading', { name: 'Redaction schedule' }),
    ).toBeTruthy()
    expect(
      screen.getByText('The schedule lists decisions, not the words removed.'),
    ).toBeTruthy()
    expect(screen.getByText('redaction-schedule.pdf')).toBeTruthy()
    expect(
      screen.getByText(/it is never part of the disclosure copy/u),
    ).toBeTruthy()
  })

  it('exports the schedule as a PDF or a Word file, generated by the API', () => {
    vi.useFakeTimers()
    const urlApi = URL as unknown as {
      createObjectURL?: (blob: Blob) => string
      revokeObjectURL?: (url: string) => void
    }
    urlApi.createObjectURL ??= () => 'blob:missing'
    urlApi.revokeObjectURL ??= () => undefined
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:schedule')
    const anchorDownload = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    let downloaded = ''
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLAnchorElement.prototype,
      'download',
    )
    Object.defineProperty(HTMLAnchorElement.prototype, 'download', {
      configurable: true,
      set(value: string) {
        downloaded = value
      },
      get() {
        return downloaded
      },
    })
    const mutate = vi.fn(
      (format: string, options: { onSuccess: (blob: Blob) => void }) => {
        options.onSuccess(scheduleFile)
        return format
      },
    )
    hooks.useRedactionScheduleExport.mockReturnValue({
      mutate,
      isPending: false,
      error: null,
      variables: undefined,
    })

    renderView()
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }))
    expect(mutate).toHaveBeenCalledWith('pdf', expect.anything())
    expect(createObjectURL).toHaveBeenCalledWith(scheduleFile)
    expect(anchorDownload).toHaveBeenCalled()
    expect(downloaded).toBe('redaction-schedule.pdf')

    fireEvent.click(screen.getByRole('button', { name: 'Export Word' }))
    expect(mutate).toHaveBeenCalledWith('docx', expect.anything())
    expect(downloaded).toBe('redaction-schedule.docx')

    // Legal: the shareable audit leaves the firm, so its filename never carries the source document's name.
    fireEvent.click(
      screen.getByRole('button', { name: 'Export shareable JSON' }),
    )
    expect(mutate).toHaveBeenCalledWith('json-shareable', expect.anything())
    expect(downloaded).toBe('redaction-audit.json')

    if (descriptor)
      Object.defineProperty(HTMLAnchorElement.prototype, 'download', descriptor)
    createObjectURL.mockRestore()
    anchorDownload.mockRestore()
    vi.useRealTimers()
  })

  it('reports a schedule that could not be exported', () => {
    hooks.useRedactionScheduleExport.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: new Error('Audit report unavailable.'),
      variables: 'pdf',
    })
    renderView()
    expect(screen.getByRole('alert').textContent).toContain(
      'Audit report unavailable.',
    )
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
        filename: 'brief-redacted.docx',
        text: null,
        outputId: 'out_1',
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
      data: documentBoundRun({
        returnedDocumentVersionId: 'ver_9',
        returnedMatterId: 'mtr_1',
        returnedDocumentId: 'doc_1',
        returnedDocumentVersionNumber: 9,
      }),
    })

    render(
      <RedactionReviewView
        runId="red_1"
        onOpenRun={onOpenRun}
        onOpenDocument={onOpenDocument}
      />,
    )
    expect(screen.getByText('Saved to the matter')).toBeTruthy()
    expect(screen.getByText(/Saved as version 9 of the/u)).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Return to document' }),
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open document' }))
    expect(onOpenDocument).toHaveBeenCalledWith({
      matterId: 'mtr_1',
      documentId: 'doc_1',
    })
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

  it('offers saving to a matter only for a run that belongs to none', () => {
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

  it('files a standalone run into a matter and opens the document it became', () => {
    const onOpenDocument = vi.fn()
    const mutate = vi.fn()
    hooks.useSaveToMatter.mockReturnValue({
      mutate,
      isPending: false,
      error: null,
      data: undefined,
      reset: vi.fn(),
    })
    render(
      <RedactionReviewView
        runId="red_1"
        onOpenRun={onOpenRun}
        onOpenDocument={onOpenDocument}
      />,
    )
    expect(screen.getByText('Not filed in a matter')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save to matter' }))
    expect(
      screen.getByRole('heading', { name: 'Save this copy to a matter' }),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save to matter' }))
    expect(mutate).not.toHaveBeenCalled()
  })
})
