// @vitest-environment jsdom
import { createElement, type PropsWithChildren } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, vi } from 'vitest'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { ApiError } from '../../api'
import { DocxWorkspace } from './docx-workspace'

const hooks = vi.hoisted(() => ({
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
  useCurrentUser: vi.fn(),
  fetchDocumentExport: vi.fn(),
}))
vi.mock('../../document-workspace-api', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../document-workspace-api')>()
  return {
    ...actual,
    useDocumentModel: hooks.useDocumentModel,
    useDocumentComments: hooks.useDocumentComments,
    useDocumentTrackedChanges: hooks.useDocumentTrackedChanges,
    useDocumentCollaborationSync: hooks.useDocumentCollaborationSync,
    useCreateDocumentComment: hooks.useCreateDocumentComment,
    useResolveDocumentComment: hooks.useResolveDocumentComment,
    useEditDocument: hooks.useEditDocument,
    useCollaborationMerge: hooks.useCollaborationMerge,
    useTrackedChangeDecision: hooks.useTrackedChangeDecision,
    usePresenceUpdate: hooks.usePresenceUpdate,
    fetchDocumentExport: hooks.fetchDocumentExport,
  }
})

const edits = vi.hoisted(() => ({
  downloadBlob: vi.fn(),
}))

vi.mock('../../document-edits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../document-edits')>()
  return { ...actual, downloadBlob: edits.downloadBlob }
})

vi.mock('../../current-user', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../current-user')>()
  return { ...actual, useCurrentUser: hooks.useCurrentUser }
})

// Only the individual mocks are re-exported: a `vi.hoisted` binding cannot be
// exported directly, but a reference to one of its properties can.
export const fetchDocumentExport = hooks.fetchDocumentExport
export const downloadBlob = edits.downloadBlob

const model: DocumentModelWire = {
  version: 1,
  stories: [
    {
      partName: 'word/document.xml',
      kind: 'document',
      paragraphs: [
        {
          id: 'p1',
          runs: [{ id: 'r1', text: 'Hello', preservedXmlFragments: [] }],
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

export const staleConflict = new ApiError(
  'conflict_detected',
  'The document has changed since editing began.',
  409,
  'req_1',
)

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

function idleMutation(overrides: Record<string, unknown> = {}) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
    ...overrides,
  }
}

export function paragraph(id: string, text: string): DocumentParagraphWire {
  return {
    id,
    runs: [{ id: `${id}-r`, text, preservedXmlFragments: [] }],
    preservedXmlFragments: [],
  }
}

export function multiParagraphModel(
  paragraphs: DocumentParagraphWire[],
): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs,
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

/**
 * Body p1, a two-cell table, then body p4. The cell paragraphs are part of the
 * story's paragraph list (as a parsed table is) but not of its body flow, which
 * is exactly the boundary the document selection must not cross.
 */
export function tabledBodyModel(
  before = 'Alpha',
  after = 'Delta',
): DocumentModelWire {
  return withTable(
    multiParagraphModel([
      paragraph('p1', before),
      paragraph('para-w14-CELL0001', 'Cell one'),
      paragraph('para-w14-CELL0002', 'Cell two'),
      paragraph('p4', after),
    ]),
  )
}

function withTable(model: DocumentModelWire): DocumentModelWire {
  const story = model.stories[0]
  if (!story) return model
  return {
    ...model,
    stories: [
      {
        ...story,
        preservedXmlFragments: [
          '<w:tbl><w:tr><w:tc><w:p w14:paraId="CELL0001"><w:r><w:t>Cell one</w:t></w:r></w:p></w:tc><w:tc><w:p w14:paraId="CELL0002"><w:r><w:t>Cell two</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
        ],
      },
    ],
  }
}

export function mountWorkspace(
  options: {
    documentId?: string
    models?: Record<string, DocumentModelWire>
    editAsync?: ReturnType<typeof vi.fn>
    mergeAsync?: ReturnType<typeof vi.fn>
  } = {},
) {
  hooks.useCurrentUser.mockReturnValue({
    data: {
      user: {
        id: 'usr_1',
        name: 'Lex',
        email: 'lex@obiter.dev',
        role: 'owner',
      },
    },
  })
  hooks.useDocumentModel.mockImplementation((id: string) => ({
    isLoading: false,
    isError: false,
    data: {
      documentId: id,
      versionId: 'ver_1',
      versionNumber: 1,
      model: options.models?.[id] ?? model,
    },
  }))
  hooks.useDocumentComments.mockReturnValue({ data: { comments: [] } })
  hooks.useDocumentTrackedChanges.mockReturnValue({ data: { changes: [] } })
  hooks.useDocumentCollaborationSync.mockReturnValue({
    data: { changed: false, participants: [], currentVersionId: 'ver_1' },
  })
  hooks.useCreateDocumentComment.mockReturnValue(idleMutation())
  hooks.useResolveDocumentComment.mockReturnValue(idleMutation())
  hooks.useEditDocument.mockReturnValue(
    idleMutation({ mutateAsync: options.editAsync ?? vi.fn() }),
  )
  hooks.useCollaborationMerge.mockReturnValue(
    idleMutation({ mutateAsync: options.mergeAsync ?? vi.fn() }),
  )
  hooks.useTrackedChangeDecision.mockReturnValue(idleMutation())
  hooks.usePresenceUpdate.mockReturnValue(idleMutation())

  return render(
    <DocxWorkspace
      documentId={options.documentId ?? 'doc_1'}
      versionId="ver_1"
      matterId="mtr_1"
      filename="brief.docx"
    />,
    { wrapper },
  )
}

// Switches an already-mounted workspace to another document, mirroring the
// same component instance receiving new props.
export function rerenderWorkspace(
  view: ReturnType<typeof render>,
  documentId: string,
) {
  view.rerender(
    <DocxWorkspace
      documentId={documentId}
      versionId="ver_1"
      matterId="mtr_1"
      filename="brief.docx"
    />,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Unsaved drafts are persisted per tab, so each test starts without the
// previous test's draft of the same document.
beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
})

export function openRibbonTab(
  name: 'Home' | 'Insert' | 'Layout' | 'References' | 'Review' | 'View',
) {
  fireEvent.click(screen.getByRole('tab', { name }))
}

export function selectBodyParagraph() {
  fireEvent.click(screen.getByText('Hello'))
}
