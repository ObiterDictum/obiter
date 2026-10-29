import { openRibbonTab } from './editor-test-commands'
import { command } from './editor-test-commands'

import '@obiter/test-dom'
import { type PropsWithChildren } from 'react'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import type { DocumentVersionRecord } from '../../documents'

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
        fetchDocumentExport: hooks.fetchDocumentExport,
      }
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

const { DocumentWorkspace } = await import('./workspace')

function model(runs: Array<[string, string]>): DocumentModelWire {
  const paragraphs: DocumentParagraphWire[] = [
    {
      id: 'p_shared',
      runs: [{ id: runs[0][0], text: runs[0][1], preservedXmlFragments: [] }],
      preservedXmlFragments: [],
    },
    {
      id: 'p_tail',
      runs: [{ id: runs[1][0], text: runs[1][1], preservedXmlFragments: [] }],
      preservedXmlFragments: [],
    },
  ]
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

const documentA = model([
  ['r_shared', 'Alpha first'],
  ['r_tail', 'Alpha tail'],
])
const documentB = model([
  ['r_shared', 'Beta first'],
  ['r_tail', 'Beta tail'],
])

function version(documentId: string): DocumentVersionRecord {
  return {
    id: `ver_${documentId}`,
    organisationId: 'org_1',
    matterId: 'mtr_1',
    matterDocumentId: documentId,
    filename: 'brief.docx',
    fileType: 'docx',
    sizeBytes: '1024',
    objectKey: `org/org_1/matters/mtr_1/documents/${documentId}/versions/v1/source`,
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

function idleMutation(overrides: Record<string, unknown> = {}) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
    ...overrides,
  }
}

function elementFor(documentId: string) {
  return (
    <DocumentWorkspace
      documentId={documentId}
      version={version(documentId)}
      layout="pane"
    />
  )
}

function mount(
  documentId: string,
  options: { editAsync?: ReturnType<typeof vi.fn> } = {},
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
      versionId: `ver_${id}`,
      versionNumber: 1,
      model: id === 'doc_b' ? documentB : documentA,
    },
  }))
  hooks.useDocumentComments.mockReturnValue({
    data: { comments: [], importedComments: [], orphanedReplies: [] },
  })
  hooks.useDocumentTrackedChanges.mockReturnValue({ data: { changes: [] } })
  hooks.useDocumentCollaborationSync.mockReturnValue({
    data: { changed: false, participants: [], currentVersionId: 'ver_doc_a' },
  })
  const editAsync = options.editAsync ?? vi.fn()
  const mergeAsync = vi.fn()
  hooks.useCreateDocumentComment.mockReturnValue(idleMutation())
  hooks.useReplyDocumentComment.mockReturnValue(idleMutation())
  hooks.useResolveDocumentComment.mockReturnValue(idleMutation())
  hooks.useReopenDocumentComment.mockReturnValue(idleMutation())
  hooks.useEditDocument.mockReturnValue(
    idleMutation({ mutateAsync: editAsync }),
  )
  hooks.useCollaborationMerge.mockReturnValue(
    idleMutation({ mutateAsync: mergeAsync }),
  )
  hooks.useTrackedChangeDecision.mockReturnValue(idleMutation())
  hooks.usePresenceUpdate.mockReturnValue(idleMutation())

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const view = render(elementFor(documentId), { wrapper })
  return { view, editAsync, mergeAsync }
}

function switchTo(view: ReturnType<typeof mount>['view'], documentId: string) {
  view.rerender(elementFor(documentId))
}

function bodyEditor(): HTMLTextAreaElement {
  const node = screen.getByLabelText('Paragraph text')
  if (!(node instanceof HTMLTextAreaElement)) {
    throw new Error('expected a paragraph editor')
  }
  return node
}

function openReviewTab() {
  openRibbonTab('Review')
}

function editSharedParagraph(text: string) {
  fireEvent.click(screen.getByText('Alpha first'))
  fireEvent.change(bodyEditor(), { target: { value: text } })
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('document-scoped editor state', () => {
  it('does not render document A draft text in document B', () => {
    const { view } = mount('doc_a')
    editSharedParagraph('Alpha edited')

    switchTo(view, 'doc_b')

    expect(screen.getByText('Beta first')).toBeTruthy()
    expect(screen.getByText('Beta tail')).toBeTruthy()
    expect(screen.queryByText('Alpha edited')).toBeNull()
  })

  it('does not render document A pending insert in document B', () => {
    const { view } = mount('doc_a')
    fireEvent.click(screen.getByText('Alpha first'))
    fireEvent.click(command('Insert paragraph'))
    fireEvent.change(screen.getByLabelText('Pending paragraph text'), {
      target: { value: 'Inserted in A' },
    })

    switchTo(view, 'doc_b')

    expect(screen.queryByLabelText('Pending paragraph text')).toBeNull()
    expect(screen.queryByText('Inserted in A')).toBeNull()
    expect(screen.getByText('Beta first')).toBeTruthy()
  })

  it('does not apply document A deleted-paragraph mask to document B', () => {
    const { view } = mount('doc_a')
    fireEvent.click(screen.getByText('Alpha first'))
    fireEvent.click(command('Delete paragraph'))
    expect(screen.queryByText('Alpha first')).toBeNull()

    switchTo(view, 'doc_b')

    expect(screen.getByText('Beta first')).toBeTruthy()
    expect(screen.getByText('Beta tail')).toBeTruthy()
  })

  it('does not carry document A selection or caret into document B', async () => {
    const { view } = mount('doc_a')
    fireEvent.click(screen.getByText('Alpha first'))

    switchTo(view, 'doc_b')

    await waitFor(() => {
      expect(document.querySelector('[aria-current="true"]')).toBeNull()
    })
    expect(screen.queryByLabelText('Paragraph text')).toBeNull()
    expect(screen.getByText('Beta first')).toBeTruthy()

    fireEvent.click(screen.getByText('Beta first'))
    expect(bodyEditor().value).toBe('Beta first')
  })

  it('does not send a mutation merely because the document changed', () => {
    const { view, editAsync, mergeAsync } = mount('doc_a')
    editSharedParagraph('Alpha edited')

    switchTo(view, 'doc_b')

    expect(editAsync).not.toHaveBeenCalled()
    expect(mergeAsync).not.toHaveBeenCalled()
  })

  it('does not save document A edits or format under document B', () => {
    const { view, editAsync, mergeAsync } = mount('doc_a')
    fireEvent.click(screen.getByText('Alpha first'))
    const editor = bodyEditor()
    editor.focus()
    editor.setSelectionRange(0, 5)
    fireEvent.select(editor)
    fireEvent.click(command('Bold'))
    fireEvent.change(bodyEditor(), { target: { value: 'Alpha edited' } })

    switchTo(view, 'doc_b')
    openReviewTab()
    fireEvent.click(command('Save'))

    expect(editAsync).not.toHaveBeenCalled()
    expect(mergeAsync).not.toHaveBeenCalled()
  })

  it('restores document A unsaved edits when returning to it, without showing them in document B', () => {
    const { view } = mount('doc_a')
    editSharedParagraph('Alpha edited')
    expect(screen.queryByText('Alpha first')).toBeNull()

    switchTo(view, 'doc_b')
    expect(screen.queryByText('Alpha edited')).toBeNull()
    expect(screen.getByText('Beta first')).toBeTruthy()

    switchTo(view, 'doc_a')

    expect(screen.getByText('Alpha edited')).toBeTruthy()
    expect(
      document
        .querySelector('[data-save-state]')
        ?.getAttribute('data-save-state'),
    ).toBe('unsaved')
  })

  it('does not carry document A redo history into document B', () => {
    const { view } = mount('doc_a')
    editSharedParagraph('Alpha edited')
    fireEvent.click(command('Undo'))
    expect(command('Redo')).toHaveProperty('disabled', false)

    switchTo(view, 'doc_b')

    expect(screen.getByText('Beta first')).toBeTruthy()
    const redo = command('Redo')
    expect(redo).toHaveProperty('disabled', true)
    fireEvent.keyDown(redo, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(screen.queryByText('Alpha edited')).toBeNull()
    expect(screen.getByText('Beta first')).toBeTruthy()
  })

  it('does not let a save that resolves after a switch touch the new document', async () => {
    let resolveSave: (value: unknown) => void = () => undefined
    const editAsync = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }),
    )
    const { view } = mount('doc_a', { editAsync })
    editSharedParagraph('Alpha edited')
    openReviewTab()
    fireEvent.click(command('Save'))
    await waitFor(() => expect(editAsync).toHaveBeenCalledTimes(1))

    switchTo(view, 'doc_b')
    await act(async () => {
      resolveSave({
        documentId: 'doc_a',
        versionId: 'ver_doc_a_2',
        versionNumber: 2,
      })
    })

    expect(screen.getByText('Beta first')).toBeTruthy()
    expect(screen.getByText('Beta tail')).toBeTruthy()
    expect(screen.queryByText('Alpha edited')).toBeNull()
    expect(command('Undo')).toHaveProperty('disabled', true)
    expect(command('Redo')).toHaveProperty('disabled', true)
  })
})
