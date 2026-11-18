import '@obiter/test-dom'
import { act, render } from '@testing-library/react'
import { beforeEach, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import type { PdfPreviewStatus } from './pdf-document-preview'

interface ReturnToDocumentFixture {
  mutate: ReturnType<typeof vi.fn>
  isPending: boolean
  error?: { message: string } | null
  data?: { documentId: string; versionId: string; versionNumber: number }
}

const hooks = vi.hoisted(() => ({
  useRedactionRun: vi.fn(),
  useRedactionDocumentText: vi.fn(),
  useRetryDetection: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  })),
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
  useReturnToDocument: vi.fn((): ReturnToDocumentFixture => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}))

const sourcePreviewHooks = vi.hoisted(() => ({
  useRedactionSource: vi.fn(() => ({
    isPending: false,
    data: undefined,
    isError: false,
  })),
}))

interface PreviewFixture {
  file: Blob | null
  onStatusChange: ((status: PdfPreviewStatus) => void) | null
  renderCount: number
}

const preview: PreviewFixture = {
  file: null,
  onStatusChange: null,
  renderCount: 0,
}

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

export {
  baseRun,
  hooks,
  onOpenRun,
  outputFile,
  preview,
  renderView,
  scheduleFile,
  setPreview,
  summary,
  RedactionReviewView,
}
