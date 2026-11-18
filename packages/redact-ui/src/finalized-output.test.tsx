import '@obiter/test-dom'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import {
  baseRun,
  hooks,
  onOpenRun,
  RedactionReviewView,
  outputFile,
  renderView,
  setPreview,
  summary,
} from './finalized-output.test-fixture'
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
    expect(screen.getByText('brief (redacted).pdf')).toBeTruthy()
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
