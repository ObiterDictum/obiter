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
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocumentModelWire } from '@obiter/contracts'
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

const staleConflict = new ApiError(
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

function mountWorkspace(options: {
  editAsync?: ReturnType<typeof vi.fn>
  mergeAsync?: ReturnType<typeof vi.fn>
}) {
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
  hooks.useDocumentModel.mockReturnValue({
    isLoading: false,
    isError: false,
    data: {
      documentId: 'doc_1',
      versionId: 'ver_1',
      versionNumber: 1,
      model,
    },
  })
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
      documentId="doc_1"
      versionId="ver_1"
      matterId="mtr_1"
      filename="brief.docx"
    />,
    { wrapper },
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DocxWorkspace export', () => {
  it('downloads the DOCX with the expected filename', async () => {
    const blob = new Blob()
    hooks.fetchDocumentExport.mockResolvedValue({
      blob,
      skippedCommentCount: 0,
    })
    mountWorkspace({})

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))

    await waitFor(() => {
      expect(hooks.fetchDocumentExport).toHaveBeenCalledWith('doc_1')
    })
    expect(edits.downloadBlob).toHaveBeenCalledWith('brief.docx', blob)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('surfaces an ApiError via the banner when the export fails', async () => {
    hooks.fetchDocumentExport.mockRejectedValue(
      new ApiError(
        'storage_unavailable',
        'The API could not complete the request.',
        500,
        'req_export',
      ),
    )
    mountWorkspace({})

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))

    await waitFor(() => {
      expect(
        screen.getByText('The API could not complete the request.'),
      ).toBeTruthy()
    })
    expect(edits.downloadBlob).not.toHaveBeenCalled()
  })

  it('downloads anyway and reports comments that were skipped', async () => {
    const blob = new Blob()
    hooks.fetchDocumentExport.mockResolvedValue({
      blob,
      skippedCommentCount: 2,
    })
    mountWorkspace({})

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))

    await waitFor(() => {
      expect(edits.downloadBlob).toHaveBeenCalledWith('brief.docx', blob)
    })
    expect(
      screen.getByText(
        '2 comments could not be placed in the exported document and were skipped.',
      ),
    ).toBeTruthy()
  })
})

describe('DocxWorkspace save', () => {
  it('merges a stale-base 409 so typed edits are not discarded', async () => {
    const editAsync = vi.fn().mockRejectedValue(staleConflict)
    const mergeAsync = vi.fn().mockResolvedValue({
      documentId: 'doc_1',
      syncId: 'sync_1',
      baseVersionId: 'ver_1',
      versionId: 'ver_2',
      versionNumber: 2,
      outcome: 'merged',
    })
    mountWorkspace({ editAsync, mergeAsync })

    fireEvent.change(screen.getByLabelText('Paragraph text'), {
      target: { value: 'Hello world' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(
        screen.getByText(
          "Your changes were saved as a new version to avoid overwriting a colleague's work",
        ),
      ).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
    expect(editAsync).toHaveBeenCalled()
    expect(mergeAsync).toHaveBeenCalled()
  })

  it('surfaces a reload banner when merge also hits a 409', async () => {
    const editAsync = vi.fn().mockRejectedValue(staleConflict)
    const mergeAsync = vi.fn().mockRejectedValue(staleConflict)
    mountWorkspace({ editAsync, mergeAsync })

    fireEvent.change(screen.getByLabelText('Paragraph text'), {
      target: { value: 'Hello world' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(
        screen.getByText('The document has changed since editing began.'),
      ).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
  })

  it('advances the save base to the version returned by the previous save', async () => {
    const editAsync = vi
      .fn()
      .mockResolvedValueOnce({
        documentId: 'doc_1',
        versionId: 'ver_2',
        versionNumber: 2,
      })
      .mockResolvedValueOnce({
        documentId: 'doc_1',
        versionId: 'ver_3',
        versionNumber: 3,
      })
    mountWorkspace({ editAsync })

    const input = screen.getByLabelText('Paragraph text')
    fireEvent.change(input, { target: { value: 'Hello world' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(editAsync).toHaveBeenCalledTimes(1)
    })
    expect(editAsync.mock.calls[0]?.[0]).toMatchObject({
      baseVersionId: 'ver_1',
    })

    fireEvent.change(screen.getByLabelText('Paragraph text'), {
      target: { value: 'Hello again' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(editAsync).toHaveBeenCalledTimes(2)
    })
    expect(editAsync.mock.calls[1]?.[0]).toMatchObject({
      baseVersionId: 'ver_2',
    })
  })
})

describe('DocxWorkspace find and undo', () => {
  it('counts matches and restores the previous draft on undo', () => {
    mountWorkspace({})

    fireEvent.change(screen.getByLabelText('Find in document'), {
      target: { value: 'hello' },
    })
    expect(screen.getByText('1 found')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }))
    expect(screen.getByText('1/1')).toBeTruthy()

    const undo = screen.getByRole('button', { name: 'Undo' })
    expect(undo).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('Paragraph text'), {
      target: { value: 'Hello world' },
    })
    expect(undo).toHaveProperty('disabled', false)
    fireEvent.click(undo)
    expect(screen.getByLabelText('Paragraph text')).toHaveProperty(
      'value',
      'Hello',
    )
  })

  it('keeps selection on the anchor paragraph after undoing a split', () => {
    mountWorkspace({})

    const editor = screen.getByLabelText('Paragraph text')
    editor.focus()
    fireEvent.keyDown(editor, { key: 'Enter' })

    const undo = screen.getByRole('button', { name: 'Undo' })
    expect(undo).toHaveProperty('disabled', false)
    fireEvent.click(undo)

    // The removed insert is gone, so selection must fall back to the
    // paragraph it was split from instead of pointing at nothing.
    expect(screen.getByLabelText('Paragraph text')).toHaveProperty(
      'value',
      'Hello',
    )
    expect(
      document
        .querySelector('[aria-current="true"]')
        ?.getAttribute('data-paragraph-id'),
    ).toBe('p1')
  })
})
