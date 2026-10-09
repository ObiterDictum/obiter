import '@obiter/test-dom'
import { createElement, type PropsWithChildren } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, mock } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { ApiError } from '../../api'

const hooks = vi.hoisted(() => ({
  useDocumentModel: vi.fn(),
  useDocumentComments: vi.fn(),
  useDocumentTrackedChanges: vi.fn(),
  useDocumentCollaborationSync: vi.fn(),
  useCreateDocumentComment: vi.fn(),
  useReplyDocumentComment: vi.fn(),
  useResolveDocumentComment: vi.fn(),
  useReopenDocumentComment: vi.fn(),
  useEditDocument: vi.fn(),
  useCollaborationMerge: vi.fn(),
  useTrackedChangeDecision: vi.fn(),
  usePresenceUpdate: vi.fn(),
  useCurrentUser: vi.fn(),
  fetchDocumentExport: vi.fn(),
}))
// The real module, snapshotted before mock.module registers: a factory
// that awaited its own specifier re-entered the in-flight mock and
// deadlocked under bun's module registry.
const documentWorkspaceApiModule = {
  ...(await import('../../document-workspace-api')),
}
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
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
      return {
        ...actual,
        useDocumentModel: hooks.useDocumentModel,
        useDocumentComments: hooks.useDocumentComments,
        useDocumentTrackedChanges: hooks.useDocumentTrackedChanges,
        useDocumentCollaborationSync: hooks.useDocumentCollaborationSync,
        useCreateDocumentComment: hooks.useCreateDocumentComment,
        useReplyDocumentComment: hooks.useReplyDocumentComment,
        useResolveDocumentComment: hooks.useResolveDocumentComment,
        useReopenDocumentComment: hooks.useReopenDocumentComment,
        useEditDocument: hooks.useEditDocument,
        useCollaborationMerge: hooks.useCollaborationMerge,
        useTrackedChangeDecision: hooks.useTrackedChangeDecision,
        usePresenceUpdate: hooks.usePresenceUpdate,
        fetchDocumentExport: hooks.fetchDocumentExport,
      }
    })(),
  ),
)

const edits = vi.hoisted(() => ({
  downloadBlob: vi.fn(),
}))

// The real module, snapshotted before mock.module registers: a factory
// that awaited its own specifier re-entered the in-flight mock and
// deadlocked under bun's module registry.
const documentEditsModule = { ...(await import('../../document-edits')) }
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const documentEditsModuleKeys = Object.fromEntries(
  Object.keys(await import('../../document-edits')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('../../document-edits', () =>
  Object.assign(
    { ...documentEditsModuleKeys },
    (() => {
      const actual = documentEditsModule
      return { ...actual, downloadBlob: edits.downloadBlob }
    })(),
  ),
)

// The real module, snapshotted before mock.module registers: a factory
// that awaited its own specifier re-entered the in-flight mock and
// deadlocked under bun's module registry.
const currentUserModule = { ...(await import('../../current-user')) }
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const currentUserModuleKeys = Object.fromEntries(
  Object.keys(await import('../../current-user')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('../../current-user', () =>
  Object.assign(
    { ...currentUserModuleKeys },
    (() => {
      const actual = currentUserModule
      return { ...actual, useCurrentUser: hooks.useCurrentUser }
    })(),
  ),
)

// Loaded after the registrations above: bun does not hoist mock.module the
// way vi.mock was hoisted, and these modules capture mocked imports at
// module scope, so they must evaluate once the mocks are in place.
const { DocxWorkspace } = await import('./docx-workspace')

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
      fields: [],
      unanchoredFieldParagraphIds: [],
    },
  ],
  styles: [],
  numbering: [],
  relationships: [],
  preservedXmlFragments: [],
  changes: [],
  comments: [],
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
        fields: [],
        unanchoredFieldParagraphIds: [],
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
    comments: [],
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

/**
 * A live document source, so a test can make a save reload the model the way
 * the real `/model` route does (new version, re-parsed identities) instead of
 * pinning one immutable fixture for the whole mount.
 */
export type WorkspaceModelSource = (id: string) => {
  versionId: string
  versionNumber: number
  model: DocumentModelWire
}

export function mountWorkspace(
  options: {
    documentId?: string
    models?: Record<string, DocumentModelWire>
    modelFor?: WorkspaceModelSource
    editAsync?: ReturnType<typeof vi.fn>
    mergeAsync?: ReturnType<typeof vi.fn>
    /** Drives the tracked-change decision path a saved tracked undo uses. */
    decideAsync?: ReturnType<typeof vi.fn>
    /** The changes the tracked-changes query returns. */
    changes?: import('@obiter/contracts').DocumentChangeWire[]
    /** Simulates the reload query failing, so a pending baseline cannot resolve. */
    modelError?: () => boolean
    /** Overrides the comments list the panel is fed. */
    comments?: {
      comments?: import('@obiter/contracts').DocumentComment[]
      importedComments?: import('@obiter/contracts').DocumentImportedCommentThread[]
      orphanedReplies?: import('@obiter/contracts').DocumentCommentReply[]
    }
    /** Drives the comment mutations; each defaults to an idle mutation. */
    createComment?: ReturnType<typeof vi.fn>
    replyComment?: ReturnType<typeof vi.fn>
    resolveComment?: ReturnType<typeof vi.fn>
    reopenComment?: ReturnType<typeof vi.fn>
    /** Overrides the signed-in user's id and organisation role. */
    user?: { id?: string; role?: 'owner' | 'admin' | 'member' }
  } = {},
) {
  hooks.useCurrentUser.mockReturnValue({
    data: {
      user: {
        id: options.user?.id ?? 'usr_1',
        name: 'Lex',
        email: 'lex@obiter.dev',
        role: options.user?.role ?? 'owner',
      },
      organisation: { id: 'org_1', name: 'Chambers', plan: 'private_beta' },
    },
  })
  hooks.useDocumentModel.mockImplementation((id: string) => {
    const current = options.modelFor?.(id) ?? {
      versionId: 'ver_1',
      versionNumber: 1,
      model: options.models?.[id] ?? model,
    }
    return {
      isLoading: false,
      isError: options.modelError?.() ?? false,
      data: { documentId: id, ...current },
    }
  })
  hooks.useDocumentComments.mockReturnValue({
    data: {
      comments: options.comments?.comments ?? [],
      importedComments: options.comments?.importedComments ?? [],
      orphanedReplies: options.comments?.orphanedReplies ?? [],
    },
  })
  hooks.useDocumentTrackedChanges.mockReturnValue({
    data: { changes: options.changes ?? [] },
  })
  hooks.useDocumentCollaborationSync.mockReturnValue({
    data: {
      changed: false,
      participants: [],
      currentVersionId:
        options.modelFor?.(options.documentId ?? 'doc_1').versionId ?? 'ver_1',
    },
  })
  hooks.useCreateDocumentComment.mockReturnValue(
    idleMutation({ mutateAsync: options.createComment ?? vi.fn() }),
  )
  hooks.useReplyDocumentComment.mockReturnValue(
    idleMutation({ mutateAsync: options.replyComment ?? vi.fn() }),
  )
  hooks.useResolveDocumentComment.mockReturnValue(
    idleMutation({ mutate: options.resolveComment ?? vi.fn() }),
  )
  hooks.useReopenDocumentComment.mockReturnValue(
    idleMutation({ mutate: options.reopenComment ?? vi.fn() }),
  )
  hooks.useEditDocument.mockReturnValue(
    idleMutation({ mutateAsync: options.editAsync ?? vi.fn() }),
  )
  hooks.useCollaborationMerge.mockReturnValue(
    idleMutation({ mutateAsync: options.mergeAsync ?? vi.fn() }),
  )
  hooks.useTrackedChangeDecision.mockReturnValue(
    idleMutation({
      // The review hook dispatches through `mutate` with result callbacks;
      // the tracked-undo save path uses `mutateAsync`. One mock serves both.
      mutate: (input: unknown, callbacks?: unknown) =>
        options.decideAsync?.(input, callbacks),
      mutateAsync: options.decideAsync ?? vi.fn(),
    }),
  )
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

export function selectBodyParagraph(text = 'Hello') {
  fireEvent.click(screen.getByText(text))
}
