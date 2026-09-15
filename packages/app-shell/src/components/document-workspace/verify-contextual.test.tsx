// @vitest-environment jsdom
import { createElement, type PropsWithChildren } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

function finding(
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

function quoteFinding(): VerificationFindingView {
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

function unmappableFinding(): VerificationFindingView {
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

function mount(findings: VerificationFindingView[]) {
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

describe('contextual verification evidence', () => {
  it('opens contextual evidence from a mapped citation', async () => {
    mount([finding()])
    const marker = await screen.findByRole('button', {
      name: /Citation resolution, Clear/,
    })
    expect(marker.tagName).toBe('BUTTON')
    fireEvent.click(marker)
    const panel = await screen.findByRole('dialog')
    expect(panel.textContent).toContain('[2012] UKSC 7')
    expect(panel.textContent).toContain('Clear')
    expect(panel.textContent).toContain('stored version ver_1')
  })

  it('opens a quotation finding from the document', async () => {
    mount([quoteFinding()])
    const marker = await screen.findByRole('button', {
      name: /Quote fidelity, Flagged/,
    })
    fireEvent.click(marker)
    const panel = await screen.findByRole('dialog')
    expect(panel.textContent).toContain('Flagged')
    expect(panel.textContent).toContain('[2012] UKSC 40')
  })

  it('navigates between mapped findings while keeping the document context', async () => {
    mount([finding(), quoteFinding()])
    fireEvent.click(
      await screen.findByRole('button', { name: /Citation resolution, Clear/ }),
    )
    const panel = await screen.findByRole('dialog')
    fireEvent.click(await screen.findByRole('button', { name: 'Next finding' }))
    await waitFor(() => {
      expect(panel.textContent).toContain('[2012] UKSC 40')
    })
    // The document target follows the selection.
    await waitFor(() => {
      const active = document.querySelector('[data-verification-active]')
      expect(active?.getAttribute('data-verification-paragraph-id')).toBe('p2')
    })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Previous finding' }),
    )
    await waitFor(() => {
      expect(panel.textContent).toContain('[2012] UKSC 7')
    })
  })

  it('closes on Escape and restores focus to the originating marker', async () => {
    mount([finding()])
    const marker = await screen.findByRole('button', {
      name: /Citation resolution, Clear/,
    })
    fireEvent.click(marker)
    await screen.findByRole('dialog')
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(document.activeElement).toBe(marker)
  })

  it('keeps the panel out of the document layout so the page cannot reflow', async () => {
    mount([finding()])
    const desk = document.querySelector('[data-document-desk]')
    const flowBefore = desk?.children.length ?? 0
    fireEvent.click(
      await screen.findByRole('button', { name: /Citation resolution, Clear/ }),
    )
    const panel = await screen.findByRole('dialog')
    expect(panel.closest('[data-document-desk]')).toBeNull()
    expect(desk?.children.length).toBe(flowBefore)
    // The marker layer is out of flow, so it cannot add a line, a margin or a
    // scroll height to the page it decorates.
    const layer = document.querySelector('[data-verification-layer]')
    expect(layer?.className).toContain('absolute')
  })

  it('keeps an unmappable finding reachable with a stated reason', async () => {
    mount([finding(), unmappableFinding()])
    await screen.findByRole('button', { name: /Citation resolution, Clear/ })
    expect(
      screen.queryByRole('button', { name: /Authority existence.*2099/ }),
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View all findings' }))
    const index = await screen.findByRole('dialog')
    expect(index.textContent).toContain('Not shown in the document')
  })

  it('does not present text edited since the check as verified', async () => {
    draftHook.useDocumentDraftStatus.mockReturnValue({ dirty: true })
    mount([finding()])
    const dock = await screen.findByRole('region', {
      name: 'Verification',
    })
    expect(dock.textContent).toContain('Stored version')
    expect(dock.textContent).toContain('unsaved')
    expect(
      (
        screen.getByRole('button', {
          name: 'Run verification',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    fireEvent.click(
      await screen.findByRole('button', { name: /Citation resolution, Clear/ }),
    )
    const panel = await screen.findByRole('dialog')
    expect(panel.textContent).toContain('stored version ver_1')
    expect(panel.textContent).toContain(
      'Unsaved edits are not part of the stored version',
    )
  })

  it('never attaches a finding to text that no longer matches what was checked', async () => {
    mount([finding({ excerpt: '[2012] UKSC 9' })])
    await screen.findByRole('region', { name: 'Verification' })
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /Citation resolution, Clear/ }),
      ).toBeNull()
    })
    fireEvent.click(screen.getByRole('button', { name: 'View all findings' }))
    const index = await screen.findByRole('dialog')
    expect(index.textContent).toContain('Not shown in the document')
  })

  it('falls back to a drawer when the viewport cannot fit the panel', async () => {
    mount([finding()])
    fireEvent.click(
      await screen.findByRole('button', { name: /Citation resolution, Clear/ }),
    )
    await screen.findByRole('dialog')
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 420,
    })
    fireEvent(window, new Event('resize'))
    await waitFor(() => {
      expect(screen.getByRole('dialog').getAttribute('data-placement')).toBe(
        'drawer',
      )
    })
  })

  it('shows one marker per place, with the most serious outcome there', async () => {
    mount([
      finding(),
      finding({
        id: 'vf_1-existence',
        type: 'authority_existence',
        state: 'flagged',
        explanation: 'The stored sources do not hold this authority.',
      }),
    ])
    const markers = await screen.findAllByRole('button', {
      name: /Citation resolution|Authority existence/,
    })
    expect(markers).toHaveLength(1)
    expect(markers[0]!.getAttribute('aria-label')).toContain('Flagged')
    expect(markers[0]!.getAttribute('aria-label')).toContain('2 findings here')
  })

  it('keeps the selected finding when the index opens and returns', async () => {
    mount([finding(), quoteFinding()])
    fireEvent.click(
      await screen.findByRole('button', { name: /Citation resolution, Clear/ }),
    )
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'View all findings' }))
    const index = await screen.findByRole('dialog')
    expect(index.textContent).toContain('All findings')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    const panel = await screen.findByRole('dialog')
    expect(panel.textContent).toContain('[2012] UKSC 7')
  })

  it('marks evidence as earlier than the document once a newer version is stored', async () => {
    storedVersionId = 'ver_2'
    mount([finding()])
    const dock = await screen.findByRole('region', { name: 'Verification' })
    expect(await screen.findByText('Earlier version')).toBeTruthy()
    expect(dock.textContent).toContain('Stored version ver_1')
  })

  it('moves focus to the run status when a run starts', async () => {
    mount([finding()])
    const start = await screen.findByRole('button', {
      name: 'Run verification',
    })
    fireEvent.click(start)
    expect(document.activeElement?.getAttribute('role')).toBe('status')
  })

  it('shows totals, the next actionable finding and the stored version', async () => {
    mount([finding(), quoteFinding(), unmappableFinding()])
    const dock = await screen.findByRole('region', { name: 'Verification' })
    expect(dock.textContent).toContain('1 clear · 1 flagged · 1 needs review')
    expect(dock.textContent).toContain('ver_1')
    fireEvent.click(screen.getByRole('button', { name: 'Go to next finding' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })
})
