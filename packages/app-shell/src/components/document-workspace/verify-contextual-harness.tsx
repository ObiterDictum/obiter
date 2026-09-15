// @vitest-environment jsdom
// Shared support for the contextual verification suites. It owns the workspace
// hook mocks, the synthetic finding fixtures and the mount helper, so the two
// suites can each read as the behaviour they cover instead of restating setup.
// It is deliberately not named `*.test.*`: only the suites are collected.
import { createElement, type PropsWithChildren } from 'react'
import { cleanup, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, vi } from 'vitest'
import type {
  DocumentModelWire,
  VerificationFindingView,
  VerificationRun,
} from '@obiter/contracts'
import { DocumentWorkspace } from './workspace'
import type { DocumentVersionRecord } from '../../documents'

const modelHook = vi.hoisted(() => ({
  useDocumentModel: vi.fn(),
  useDocumentComments: vi.fn(),
  useDocumentTrackedChanges: vi.fn(),
  useDocumentCollaborationSync: vi.fn(),
  useCreateDocumentComment: vi.fn(),
  useResolveDocumentComment: vi.fn(),
  useEditDocument: vi.fn(),
  useCollaborationMerge: vi.fn(),
  useTrackedChangeDecision: vi.fn(),
  usePresenceUpdate: vi.fn(),
  fetchDocumentExport: vi.fn(),
}))
vi.mock('../../document-workspace-api', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../document-workspace-api')>()
  return {
    ...actual,
    useDocumentModel: modelHook.useDocumentModel,
    useDocumentComments: modelHook.useDocumentComments,
    useDocumentTrackedChanges: modelHook.useDocumentTrackedChanges,
    useDocumentCollaborationSync: modelHook.useDocumentCollaborationSync,
    useCreateDocumentComment: modelHook.useCreateDocumentComment,
    useResolveDocumentComment: modelHook.useResolveDocumentComment,
    useEditDocument: modelHook.useEditDocument,
    useCollaborationMerge: modelHook.useCollaborationMerge,
    useTrackedChangeDecision: modelHook.useTrackedChangeDecision,
    usePresenceUpdate: modelHook.usePresenceUpdate,
    fetchDocumentExport: modelHook.fetchDocumentExport,
  }
})

const userHook = vi.hoisted(() => ({ useCurrentUser: vi.fn() }))
vi.mock('../../current-user', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../current-user')>()
  return { ...actual, useCurrentUser: userHook.useCurrentUser }
})

const documentHook = vi.hoisted(() => ({ useDocument: vi.fn() }))
vi.mock('../../documents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../documents')>()
  return { ...actual, useDocument: documentHook.useDocument }
})

const runsHook = vi.hoisted(() => ({
  useDocumentVerificationRuns: vi.fn(),
  useCreateVerificationRun: vi.fn(),
  useVerificationFindings: vi.fn(),
  latestVerificationRun: vi.fn(),
}))
vi.mock('../../verification-runs', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../verification-runs')>()
  return {
    ...actual,
    useDocumentVerificationRuns: runsHook.useDocumentVerificationRuns,
    useCreateVerificationRun: runsHook.useCreateVerificationRun,
    useVerificationFindings: runsHook.useVerificationFindings,
    latestVerificationRun: runsHook.latestVerificationRun,
  }
})

const draftHook = vi.hoisted(() => ({ useDocumentDraftStatus: vi.fn() }))
vi.mock('./document-draft-status', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./document-draft-status')>()
  return { ...actual, useDocumentDraftStatus: draftHook.useDocumentDraftStatus }
})

const CITATION_PARAGRAPH = 'See Anderson v Shetland [2012] UKSC 7 on fairness.'
const QUOTE_PARAGRAPH =
  'Crane J held that "the court must give the claimant a fair opportunity".'

function model(): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: [
          {
            id: 'p1',
            runs: [
              { id: 'r1', text: CITATION_PARAGRAPH, preservedXmlFragments: [] },
            ],
            preservedXmlFragments: [],
          },
          {
            id: 'p2',
            runs: [
              { id: 'r2', text: QUOTE_PARAGRAPH, preservedXmlFragments: [] },
            ],
            preservedXmlFragments: [],
          },
        ],
        preservedXmlFragments: [],
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
  }
}

function location(paragraphId: string, text: string, needle: string) {
  const start = text.indexOf(needle)
  return {
    paragraphId,
    storyKind: 'document' as const,
    storyPartName: 'word/document.xml',
    start,
    end: start + needle.length,
  }
}

export function finding(
  overrides: Partial<VerificationFindingView> = {},
): VerificationFindingView {
  return {
    id: 'vf_1',
    type: 'citation_resolution',
    state: 'clear',
    reviewReason: null,
    severity: 'low',
    confidence: 'high',
    requiresReview: false,
    explanation: 'The citation resolved to one stored authority.',
    excerpt: '[2012] UKSC 7',
    location: location('p1', CITATION_PARAGRAPH, '[2012] UKSC 7'),
    authorityLabel: '[2012] UKSC 7',
    evidence: [
      {
        id: 'ev_1',
        sourceId: 'uksc-2012-7',
        label: 'Judgment uksc-2012-7',
      },
    ],
    ...overrides,
  }
}

export function quoteFinding(): VerificationFindingView {
  return finding({
    id: 'vf_2',
    type: 'quote_fidelity',
    state: 'flagged',
    severity: 'high',
    explanation:
      'The stored passage differs from the quotation in its wording.',
    excerpt: 'the court must give the claimant a fair opportunity',
    location: location(
      'p2',
      QUOTE_PARAGRAPH,
      'the court must give the claimant a fair opportunity',
    ),
    authorityLabel: '[2012] UKSC 40',
    evidence: [],
  })
}

export function unmappableFinding(): VerificationFindingView {
  return finding({
    id: 'vf_3',
    type: 'authority_existence',
    state: 'review_required',
    reviewReason: 'authority_not_held',
    requiresReview: true,
    explanation: 'The stored sources do not hold this authority.',
    excerpt: '[2099] EWHC 999 (Ch)',
    location: location('p-gone', CITATION_PARAGRAPH, '[2012] UKSC 7'),
    authorityLabel: 'Unresolved citation',
    evidence: [],
  })
}

function run(overrides: Partial<VerificationRun> = {}): VerificationRun {
  return {
    id: 'vrun_1',
    organisationId: 'org_1',
    matterId: 'mtr_1',
    documentId: 'doc_1',
    documentVersionId: 'ver_1',
    status: 'completed',
    failureCode: null,
    createdBy: 'usr_1',
    createdAt: '2026-09-14T00:00:00.000Z',
    startedAt: '2026-09-14T00:00:01.000Z',
    completedAt: '2026-09-14T00:00:02.000Z',
    summary: { findingCount: 3, flaggedCount: 1, reviewRequiredCount: 1 },
    documentCurrentVersionId: 'ver_1',
    stale: false,
    ...overrides,
  }
}

function version(): DocumentVersionRecord {
  return {
    id: 'ver_1',
    organisationId: 'org_1',
    matterId: 'mtr_1',
    matterDocumentId: 'doc_1',
    filename: 'advice.docx',
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
  }
}

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

function idleMutation() {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  }
}

let storedVersionId = 'ver_1'

/** The stored version the open document reports, for stale-evidence cases. */
export function setStoredVersionId(id: string) {
  storedVersionId = id
}

/** Report unsaved editor work, as the E45 save owner would. */
export function setUnsavedWork(dirty: boolean) {
  draftHook.useDocumentDraftStatus.mockReturnValue({ dirty })
}

export function mount(findings: VerificationFindingView[]) {
  modelHook.useDocumentModel.mockReturnValue({
    isLoading: false,
    isError: false,
    data: {
      documentId: 'doc_1',
      versionId: 'ver_1',
      versionNumber: 1,
      model: model(),
    },
  })
  modelHook.useDocumentComments.mockReturnValue({ data: { comments: [] } })
  modelHook.useDocumentTrackedChanges.mockReturnValue({ data: { changes: [] } })
  modelHook.useDocumentCollaborationSync.mockReturnValue({
    data: { changed: false, participants: [], currentVersionId: 'ver_1' },
  })
  modelHook.useCreateDocumentComment.mockReturnValue(idleMutation())
  modelHook.useResolveDocumentComment.mockReturnValue(idleMutation())
  modelHook.useEditDocument.mockReturnValue(idleMutation())
  modelHook.useCollaborationMerge.mockReturnValue(idleMutation())
  modelHook.useTrackedChangeDecision.mockReturnValue(idleMutation())
  modelHook.usePresenceUpdate.mockReturnValue(idleMutation())
  modelHook.fetchDocumentExport.mockResolvedValue({
    blob: new Blob(),
    skippedCommentCount: 0,
  })
  userHook.useCurrentUser.mockReturnValue({
    data: { user: { id: 'usr_1', name: 'Lex', role: 'owner' } },
  })
  documentHook.useDocument.mockReturnValue({
    isPending: false,
    isError: false,
    data: {
      document: {
        currentVersion: { id: storedVersionId, documentStatus: 'ready' },
      },
    },
  })
  const completed = run()
  runsHook.useDocumentVerificationRuns.mockReturnValue({
    isPending: false,
    isError: false,
    data: { runs: [completed] },
  })
  runsHook.latestVerificationRun.mockReturnValue(completed)
  runsHook.useCreateVerificationRun.mockReturnValue(idleMutation())
  runsHook.useVerificationFindings.mockReturnValue({
    isPending: false,
    isError: false,
    findings,
  })
  return render(<DocumentWorkspace documentId="doc_1" version={version()} />, {
    wrapper,
  })
}

beforeEach(() => {
  draftHook.useDocumentDraftStatus.mockReturnValue(null)
  storedVersionId = 'ver_1'
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
