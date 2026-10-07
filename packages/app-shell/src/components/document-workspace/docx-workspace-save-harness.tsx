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
    comments: [],
  }
}

/** A stored document with one paragraph per text, ids `p1`, `p2`, ... A test
 * that needs a deletion the client keeps valid (the E45 containment probes)
 * supplies two so the delete is not the last-paragraph refusal. */
function modelWithParagraphs(texts: readonly string[]): DocumentModelWire {
  const base = model(texts[0] ?? '')
  const story = base.stories[0]
  if (!story) return base
  return {
    ...base,
    stories: [
      {
        ...story,
        paragraphs: texts.map((text, index) => ({
          id: `p${String(index + 1)}`,
          runs: [
            { id: `r${String(index + 1)}`, text, preservedXmlFragments: [] },
          ],
          preservedXmlFragments: [],
        })),
      },
    ],
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
  /** One stored paragraph per text; defaults to a single `body` paragraph. */
  paragraphs?: readonly string[]
  /** Rendered next to the workspace, inside the draft-status provider. */
  beside?: ReactNode
}

/**
 * Point every workspace hook at a ready one-paragraph document. Exported
 * separately so a test can render a different boundary around the same
 * workspace without restating the fixtures.
 */
export function configureSaveWorkspaceHooks(options: SaveWorkspaceOptions) {
  // A successful save advances the served model version, so the workspace's
  // version-matched reload gate resolves exactly as it does against the API.
  let currentVersionId = options.versionId ?? 'ver_1'
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
      versionId: currentVersionId,
      versionNumber: 1,
      model: options.paragraphs
        ? modelWithParagraphs(options.paragraphs)
        : model(options.body ?? 'Hello'),
    },
  }))
  hooks.useDocumentComments.mockReturnValue({
    data: { comments: [], importedComments: [], orphanedReplies: [] },
  })
  hooks.useDocumentTrackedChanges.mockReturnValue({ data: { changes: [] } })
  hooks.useDocumentCollaborationSync.mockReturnValue({
    data: {
      changed: false,
      participants: [],
      currentVersionId: options.versionId ?? 'ver_1',
    },
  })
  hooks.useCreateDocumentComment.mockReturnValue(idleMutation())
  hooks.useReplyDocumentComment.mockReturnValue(idleMutation())
  hooks.useResolveDocumentComment.mockReturnValue(idleMutation())
  hooks.useReopenDocumentComment.mockReturnValue(idleMutation())
  hooks.useEditDocument.mockReturnValue(
    idleMutation({
      mutateAsync: async (input: unknown) => {
        const result = await (options.editAsync ?? vi.fn())(input)
        return withSyntheticLineage(result, input)
      },
    }),
  )
  hooks.useCollaborationMerge.mockReturnValue(
    idleMutation({
      mutateAsync: async (input: unknown) => {
        const result = await (options.mergeAsync ?? vi.fn())(input)
        return withSyntheticLineage(result, input)
      },
    }),
  )
  hooks.useTrackedChangeDecision.mockReturnValue(idleMutation())
  hooks.usePresenceUpdate.mockReturnValue(idleMutation())

  /**
   * The harness stands in for a save-harness operation, not for identity
   * resolution: a server that commits always returns a lineage covering the
   * batch. Identity correctness is proved against the real pipeline in the
   * lineage tests, so this only reflects the response shape the API produces.
   */
  function withSyntheticLineage(result: unknown, input: unknown) {
    if (!result || typeof result !== 'object') return result
    // SAFETY: the guard above proves `result` is a non-null object; the cast
    // only names the two optional fields this harness reads.
    const record = result as { versionId?: unknown; lineage?: unknown }
    if (typeof record.versionId !== 'string') return result
    currentVersionId = record.versionId
    if (record.lineage) return result
    // SAFETY: the harness receives the request body its caller passes; only
    // these optional fields are read, and a missing body is treated as empty.
    const request = (input ?? {}) as {
      baseVersionId?: string
      operations?: Array<{
        type?: string
        intentId?: string
        paragraphId?: string
      }>
    }
    const paragraphs: Array<{
      fromParagraphId: string | null
      toParagraphId: string | null
      insertedByIntent?: string
      runs: unknown[]
    }> = []
    // The harness model is the fixed `p1`/`r1` document, so the base story
    // entry always maps back to itself. This is the run address a covered
    // run-keyed reversal resolves through; without it the boundary is refused.
    paragraphs.push({
      fromParagraphId: 'p1',
      toParagraphId: 'p1',
      runs: [
        {
          runIndex: 0,
          segments: [{ fromRunId: 'r1', fromOffset: 0, toOffset: 0 }],
        },
      ],
    })
    for (const operation of request.operations ?? []) {
      if (operation.type === 'insert_paragraph_after') {
        paragraphs.push({
          fromParagraphId: null,
          toParagraphId: `para-w14-test-${String(operation.intentId ?? 'x')}`,
          ...(operation.intentId
            ? { insertedByIntent: operation.intentId }
            : {}),
          runs: [],
        })
      } else if (
        operation.type === 'delete_paragraph' &&
        operation.paragraphId
      ) {
        paragraphs.push({
          fromParagraphId: operation.paragraphId,
          toParagraphId: null,
          runs: [],
        })
      }
    }
    return {
      ...record,
      lineage: {
        version: 1,
        baseVersionId: request.baseVersionId ?? 'ver_1',
        versionId: record.versionId,
        acceptedOperations: (request.operations ?? []).map((_, index) => index),
        paragraphs,
      },
    }
  }
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
