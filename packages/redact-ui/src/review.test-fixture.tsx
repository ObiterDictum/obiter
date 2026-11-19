import '@obiter/test-dom'
import { render } from '@testing-library/react'
import { beforeEach, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import type { RedactionRun } from './types'

interface MutationFixture {
  mutate: ReturnType<typeof vi.fn>
  isPending: boolean
  error?: Error | null
}

const hooks = vi.hoisted(() => ({
  useRedactionRun: vi.fn(),
  useRetryDetection: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  })),
  useRedactionDocumentText: vi.fn(),
  useRedactionOutput: vi.fn(() => ({ isPending: false })),
  useRedactionOutputFile: vi.fn(() => ({
    isPending: false,
    data: undefined,
    error: null,
  })),
  useRedactionScheduleExport: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
    variables: undefined,
  })),
  useCreateUploadedRedactionRun: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  })),
  useSpanDecision: vi.fn((): MutationFixture => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  })),
  useFinalizeRun: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useRedetectRun: vi.fn((): MutationFixture => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  })),
  useReturnToDocument: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}))

const sourcePreviewHooks = vi.hoisted(() => ({
  useRedactionSource: vi.fn(() => ({
    isPending: false,
    data: undefined,
    isError: false,
  })),
}))

const appShell = { currentUserId: 'usr_me', apiFetch: vi.fn() }

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
const { isTypingTarget } = await import('@obiter/app-shell')
mock.module('@obiter/app-shell', () => ({
  isTypingTarget,
  apiFetch: appShell.apiFetch,
  useCurrentUser: () => ({ data: { user: { id: appShell.currentUserId } } }),
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

if (typeof globalThis.CSS === 'undefined') {
  Object.assign(globalThis, { CSS: { escape: (value: string) => value } })
}
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => undefined
}

const spans: RedactionRun['spans'] = [
  {
    id: 'span_1',
    start: 0,
    end: 4,
    text: 'Jane',
    category: 'person_name',
    source: 'rampart_model',
    confidence: 'high',
    suggestion: 'redact',
  },
  {
    id: 'span_2',
    start: 5,
    end: 15,
    text: '9 May 1988',
    category: 'date',
    source: 'rampart_model',
    confidence: 'medium',
    suggestion: 'redact',
  },
]

const decidedRun: RedactionRun = {
  id: 'red_1',
  matterId: null,
  matterName: null,
  documentId: null,
  documentVersionId: null,
  sourceFilename: 'statement-of-mrs-hughes.pdf',
  sourcePreview: { kind: 'text', available: false },
  status: 'reviewing',
  policyMode: 'internal_ai_minimisation',
  spans,
  decisions: {
    span_1: {
      decision: 'accept',
      decidedBy: 'usr_me',
      decidedAt: '2026-10-26T14:42:00.000Z',
    },
    span_2: {
      decision: 'reject',
      decidedBy: 'usr_other',
      decidedAt: '2026-10-26T15:02:00.000Z',
    },
  },
  outputId: null,
  detectorVersion: null,
  detectionMode: 'model+supplement',
  replacesRunId: null,
  replacementRunId: null,
  returnedDocumentVersionId: null,
  summary: {
    totalSpans: 2,
    byCategory: {
      person_name: 1,
      date: 1,
      email: 0,
      phone: 0,
      address: 0,
      government_id: 0,
      account_number: 0,
      passport: 0,
      drivers_license: 0,
      url: 0,
      ip_address: 0,
      national_insurance: 0,
      case_reference: 0,
      organisation_name: 0,
      secret: 0,
    },
    bySource: { rampartModel: 2, rampartDeterministic: 0, ukSupplement: 0 },
    reviewedCount: 2,
    unreviewedCount: 0,
  },
  createdAt: '2026-10-26T14:00:00.000Z',
  updatedAt: '2026-10-26T14:00:00.000Z',
}

function renderRun(overrides: Partial<RedactionRun> = {}) {
  const run = { ...decidedRun, ...overrides }
  hooks.useRedactionRun.mockReturnValue({ isPending: false, data: run })
  hooks.useRedactionDocumentText.mockReturnValue({
    isPending: false,
    data: { text: 'Jane (born 9 May 1988) filed.' },
  })
  return render(<RedactionReviewView runId={run.id} onOpenRun={onOpenRun} />)
}

beforeEach(() => {
  onOpenRun.mockReset()
  appShell.currentUserId = 'usr_me'
  appShell.apiFetch.mockReset()
  hooks.useSpanDecision.mockReturnValue({ mutate: vi.fn(), isPending: false })
  hooks.useFinalizeRun.mockReturnValue({ mutate: vi.fn(), isPending: false })
  hooks.useRedetectRun.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  })
  hooks.useRedactionOutput.mockReturnValue({ isPending: false })
})

export {
  RedactionReviewView,
  appShell,
  decidedRun,
  hooks,
  onOpenRun,
  renderRun,
  sourcePreviewHooks,
  spans,
}
