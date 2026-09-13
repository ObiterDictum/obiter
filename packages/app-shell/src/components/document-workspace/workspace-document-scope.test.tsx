// @vitest-environment jsdom
import { type PropsWithChildren } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import type { DocumentVersionRecord } from '../../documents'
import { DocumentWorkspace } from './workspace'

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

vi.mock('../../current-user', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../current-user')>()
  return { ...actual, useCurrentUser: hooks.useCurrentUser }
})

// The two documents deliberately share paragraph and run ids. The original
// browser report had the previous document's draft rendered over the next
// document's paragraph because the ids collided positionally.
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
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
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

function mount(documentId: string) {
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
  hooks.useDocumentComments.mockReturnValue({ data: { comments: [] } })
  hooks.useDocumentTrackedChanges.mockReturnValue({ data: { changes: [] } })
  hooks.useDocumentCollaborationSync.mockReturnValue({
    data: { changed: false, participants: [], currentVersionId: 'ver_doc_a' },
  })
  const editAsync = vi.fn()
  const mergeAsync = vi.fn()
  hooks.useCreateDocumentComment.mockReturnValue(idleMutation())
  hooks.useResolveDocumentComment.mockReturnValue(idleMutation())
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
  fireEvent.click(screen.getByRole('tab', { name: 'Review' }))
}

/** Selects the shared first paragraph and types a replacement into it. */
function editSharedParagraph(text: string) {
  fireEvent.click(screen.getByText('Alpha first'))
  fireEvent.change(bodyEditor(), { target: { value: text } })
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
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
    fireEvent.click(screen.getByRole('button', { name: 'Insert paragraph' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Delete paragraph' }))
    expect(screen.queryByText('Alpha first')).toBeNull()

    switchTo(view, 'doc_b')

    // B shares the paragraph id A deleted, so a leaked mask would hide it.
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
    // No paragraph is selected, so B mounts no caret-holding editor and cannot
    // consume A's restoreCaret.
    expect(screen.queryByLabelText('Paragraph text')).toBeNull()
    expect(screen.getByText('Beta first')).toBeTruthy()

    // B derives its own caret from B: selecting B's shared paragraph opens an
    // editor holding B's text, not A's draft or restored offset.
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
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    fireEvent.change(bodyEditor(), { target: { value: 'Alpha edited' } })

    switchTo(view, 'doc_b')
    openReviewTab()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    // A leaked draft or emphasis would make B dirty and send A's operations
    // to the API under B's document and base version.
    expect(editAsync).not.toHaveBeenCalled()
    expect(mergeAsync).not.toHaveBeenCalled()
  })

  it('discards document A transient edits rather than restoring them on return', () => {
    const { view } = mount('doc_a')
    editSharedParagraph('Alpha edited')
    expect(screen.queryByText('Alpha first')).toBeNull()

    switchTo(view, 'doc_b')
    switchTo(view, 'doc_a')

    // Unsaved drafts are not persisted per document and there is no navigation
    // guard, so leaving A discards them; returning renders server state.
    expect(screen.getAllByText('Alpha first').length).toBeGreaterThan(0)
    expect(screen.queryAllByText('Alpha edited')).toHaveLength(0)
  })
})
