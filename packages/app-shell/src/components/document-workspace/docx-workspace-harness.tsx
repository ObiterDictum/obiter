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
import { requestCitation } from '../../pending-citation'

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
  useUpdateDocumentMarkings: vi.fn(),
  fetchDocumentExport: vi.fn(),
}))
const documentWorkspaceApiModule = {
  ...(await import('../../document-workspace-api')),
}
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
        useUpdateDocumentMarkings: hooks.useUpdateDocumentMarkings,
        fetchDocumentExport: hooks.fetchDocumentExport,
      }
    })(),
  ),
)

const edits = vi.hoisted(() => ({
  downloadBlob: vi.fn(),
}))

const documentEditsModule = { ...(await import('../../document-edits')) }
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

const currentUserModule = { ...(await import('../../current-user')) }
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

const { DocxWorkspace } = await import('./docx-workspace')

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
  trackRevisions: false,
  markings: {
    documentKind: null,
    draft: false,
    privileged: false,
    withoutPrejudice: false,
  },
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
    runs: [
      {
        id: `${id}-r`,
        text,
        textRevisionEligible: true,
        preservedXmlFragments: [],
      },
    ],
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
    trackRevisions: false,
    markings: {
      documentKind: null,
      draft: false,
      privileged: false,
      withoutPrejudice: false,
    },
  }
}

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
    decideAsync?: ReturnType<typeof vi.fn>
    decideError?: Error | null
    markingsAsync?: ReturnType<typeof vi.fn>
    changes?: import('@obiter/contracts').DocumentChangeWire[]
    modelError?: () => boolean
    comments?: {
      comments?: import('@obiter/contracts').DocumentComment[]
      importedComments?: import('@obiter/contracts').DocumentImportedCommentThread[]
      orphanedReplies?: import('@obiter/contracts').DocumentCommentReply[]
    }
    createComment?: ReturnType<typeof vi.fn>
    replyComment?: ReturnType<typeof vi.fn>
    resolveComment?: ReturnType<typeof vi.fn>
    reopenComment?: ReturnType<typeof vi.fn>
    user?: { id?: string; role?: 'owner' | 'admin' | 'member' }
    pendingCitation?: string
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
      error: options.decideError ?? null,
      mutate: (input: unknown, callbacks?: unknown) =>
        options.decideAsync?.(input, callbacks),
      mutateAsync: options.decideAsync ?? vi.fn(),
    }),
  )
  hooks.usePresenceUpdate.mockReturnValue(idleMutation())
  hooks.useUpdateDocumentMarkings.mockReturnValue(
    idleMutation({
      mutate: (input: unknown, callbacks?: unknown) =>
        options.markingsAsync?.(input, callbacks),
    }),
  )

  if (options.pendingCitation !== undefined) {
    requestCitation(options.documentId ?? 'doc_1', options.pendingCitation)
  }
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

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
})

export { command, commandOrNull, commandPrefix } from './editor-test-commands'

export function selectBodyParagraph(text = 'Hello') {
  fireEvent.click(screen.getByText(text))
}
