import '@obiter/test-dom'
import { createElement, type PropsWithChildren, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, mock } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { ApiError } from '../../api'
import type { DocumentVersionRecord } from '../../documents'
import { DocumentDraftStatusProvider } from './document-draft-status'

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
        useResolveDocumentComment: hooks.useResolveDocumentComment,
        useEditDocument: hooks.useEditDocument,
        useCollaborationMerge: hooks.useCollaborationMerge,
        useTrackedChangeDecision: hooks.useTrackedChangeDecision,
        usePresenceUpdate: hooks.usePresenceUpdate,
        fetchDocumentExport: hooks.fetchDocumentExport,
      }
    })(),
  ),
)

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
      return { ...actual, downloadBlob: vi.fn() }
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
const { DocumentWorkspace } = await import('./workspace')

export const STYLE_ID = 'Heading1'

function model(text = 'Hello', styleId?: string): DocumentModelWire {
  const paragraph: DocumentParagraphWire = {
    id: 'p1',
    ...(styleId ? { styleId } : {}),
    runs: [{ id: 'r1', text, preservedXmlFragments: [] }],
    preservedXmlFragments: [],
  }
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: [paragraph],
        preservedXmlFragments: [],
      },
    ],
    styles: [
      {
        styleId: STYLE_ID,
        sourceFragment:
          '<w:style w:type="paragraph"><w:name w:val="Heading 1"/></w:style>',
      },
    ],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
  }
}

export const validationFailed = new ApiError(
  'validation_failed',
  'The document edit request is invalid.',
  400,
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

export type SaveWorkspaceOptions = {
  editAsync?: ReturnType<typeof vi.fn>
  mergeAsync?: ReturnType<typeof vi.fn>
  versionId?: string
  body?: string
  /** Rendered next to the workspace, inside the draft-status provider. */
  beside?: ReactNode
}

/**
 * Point every workspace hook at a ready one-paragraph document. Exported
 * separately so a test can render a different boundary around the same
 * workspace without restating the fixtures.
 */
export function configureSaveWorkspaceHooks(options: SaveWorkspaceOptions) {
  hooks.useCurrentUser.mockReturnValue({
    data: {
      user: {
        id: 'usr_1',
        name: 'Lex',
        email: 'lex@obiter.dev',
        role: 'owner',
      },
      organisation: { id: 'org_1', name: 'Chambers', plan: 'private_beta' },
    },
  })
  hooks.useDocumentModel.mockImplementation((id: string) => ({
    isLoading: false,
    isError: false,
    data: {
      documentId: id,
      versionId: options.versionId ?? 'ver_1',
      versionNumber: 1,
      model: model(options.body ?? 'Hello'),
    },
  }))
  hooks.useDocumentComments.mockReturnValue({ data: { comments: [] } })
  hooks.useDocumentTrackedChanges.mockReturnValue({ data: { changes: [] } })
  hooks.useDocumentCollaborationSync.mockReturnValue({
    data: {
      changed: false,
      participants: [],
      currentVersionId: options.versionId ?? 'ver_1',
    },
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
}

export function mountSaveWorkspace(options: SaveWorkspaceOptions) {
  configureSaveWorkspaceHooks(options)
  return render(
    <DocumentDraftStatusProvider>
      <DocxWorkspace
        documentId="doc_1"
        versionId={options.versionId ?? 'ver_1'}
        matterId="mtr_1"
        filename="brief.docx"
      />
      {options.beside}
    </DocumentDraftStatusProvider>,
    { wrapper },
  )
}

/**
 * The same workspace inside its real route boundary. The verification dock and
 * the draft-status provider live in `DocumentWorkspace`, so a gate test has to
 * mount that boundary rather than the viewer alone.
 */
export function mountSaveDocumentWorkspace(options: SaveWorkspaceOptions) {
  configureSaveWorkspaceHooks(options)
  return render(
    <DocumentWorkspace
      documentId="doc_1"
      version={versionRecord(options.versionId ?? 'ver_1')}
    />,
    { wrapper },
  )
}

function versionRecord(id: string): DocumentVersionRecord {
  return {
    id,
    organisationId: 'org_1',
    matterId: 'mtr_1',
    matterDocumentId: 'doc_1',
    filename: 'brief.docx',
    fileType: 'docx',
    sizeBytes: '1024',
    objectKey: `org/org_1/matters/mtr_1/documents/doc_1/versions/${id}/source`,
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

export function bodyEditor(): HTMLTextAreaElement {
  const node = screen.getByLabelText('Paragraph text')
  if (!(node instanceof HTMLTextAreaElement)) {
    throw new Error('expected a paragraph editor')
  }
  return node
}

export function saveState() {
  return document
    .querySelector('[data-save-state]')
    ?.getAttribute('data-save-state')
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

export function openReviewTab() {
  fireEvent.click(screen.getByRole('tab', { name: 'Review' }))
}
