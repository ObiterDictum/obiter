// @vitest-environment jsdom
import { createElement, type PropsWithChildren } from 'react'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DocumentEditOperation,
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

vi.mock('../../document-edits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../document-edits')>()
  return { ...actual, downloadBlob: vi.fn() }
})

vi.mock('../../current-user', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../current-user')>()
  return { ...actual, useCurrentUser: hooks.useCurrentUser }
})

const STYLE_ID = 'Heading1'

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

const validationFailed = new ApiError(
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

function mount(options: {
  editAsync?: ReturnType<typeof vi.fn>
  mergeAsync?: ReturnType<typeof vi.fn>
  versionId?: string
  body?: string
}) {
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

  return render(
    <DocxWorkspace
      documentId="doc_1"
      versionId={options.versionId ?? 'ver_1'}
      matterId="mtr_1"
      filename="brief.docx"
    />,
    { wrapper },
  )
}

function bodyEditor(): HTMLTextAreaElement {
  const node = screen.getByLabelText('Paragraph text')
  if (!(node instanceof HTMLTextAreaElement)) {
    throw new Error('expected a paragraph editor')
  }
  return node
}

function saveState() {
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

describe('E45 a rejected save must not poison later saves', () => {
  it('addresses a style applied to an unsaved paragraph to that paragraph', async () => {
    const editAsync = vi.fn().mockResolvedValue({
      documentId: 'doc_1',
      versionId: 'ver_2',
      versionNumber: 2,
    })
    mount({ editAsync })
    fireEvent.click(screen.getByText('Hello'))
    fireEvent.click(screen.getByRole('button', { name: 'Insert paragraph' }))
    fireEvent.change(screen.getByLabelText('Pending paragraph text'), {
      target: { value: 'Draft insight' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Heading 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(editAsync).toHaveBeenCalledTimes(1))
    const operations = editAsync.mock.calls[0]?.[0].operations as
      DocumentEditOperation[] | undefined
    const insert = operations?.find(
      (operation) => operation.type === 'insert_paragraph_after',
    )
    expect(insert).toMatchObject({
      type: 'insert_paragraph_after',
      paragraphId: 'p1',
      styleId: STYLE_ID,
    })
    // Every addressed node must exist on the server. The unsaved paragraph has
    // no server id, so a separate set_paragraph_style for it is unaddressable
    // and would fail this and every later save.
    for (const operation of operations ?? []) {
      const addressed =
        'paragraphId' in operation
          ? operation.paragraphId
          : 'runId' in operation
            ? operation.runId
            : undefined
      if (addressed !== undefined && addressed !== 'p1' && addressed !== 'r1') {
        throw new Error(
          `operation addresses ${addressed}, which is not in the stored model: ${JSON.stringify(operation)}`,
        )
      }
    }
  })

  it('saves later valid work when the server rejects one change in the batch', async () => {
    // Models the server's atomic batch rule for this document: one paragraph
    // and no inserts means deleting every paragraph is rejected. The typed text
    // in the same batch is valid and must still reach the server.
    const saved: string[] = []
    const editAsync = vi.fn(
      async (input: { operations: DocumentEditOperation[] }) => {
        if (input.operations.some((op) => op.type === 'delete_paragraph')) {
          throw validationFailed
        }
        const version = `ver_${String(saved.length + 2)}`
        saved.push(
          ...input.operations
            .filter((op) => op.type === 'replace_run_text')
            .map((op) => ('text' in op ? op.text : '')),
        )
        return { documentId: 'doc_1', versionId: version, versionNumber: 2 }
      },
    )
    mount({ editAsync })
    fireEvent.click(screen.getByText('Hello'))
    fireEvent.change(bodyEditor(), { target: { value: 'Hello world' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete paragraph' }))
    openReviewTab()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(saved).toContain('Hello world')
    })
    expect(editAsync.mock.calls.length).toBeGreaterThan(1)
    expect(screen.getByText(/rejected a paragraph deletion/i)).toBeTruthy()
  })

  it('does not discard it when the save is rejected and then retried', async () => {
    const editAsync = vi
      .fn()
      .mockRejectedValueOnce(validationFailed)
      .mockResolvedValue({
        documentId: 'doc_1',
        versionId: 'ver_2',
        versionNumber: 2,
      })
    mount({ editAsync })
    fireEvent.click(screen.getByText('Hello'))
    fireEvent.change(bodyEditor(), { target: { value: 'Hello world' } })
    openReviewTab()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry save' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))

    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(editAsync.mock.calls[1]?.[0].operations).toEqual([
      { type: 'replace_run_text', runId: 'r1', text: 'Hello world' },
    ])
  })

  it('keeps text typed while a save was in flight', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined
    const editAsync = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValue({
        documentId: 'doc_1',
        versionId: 'ver_3',
        versionNumber: 3,
      })
    mount({ editAsync })
    fireEvent.click(screen.getByText('Hello'))
    fireEvent.change(bodyEditor(), { target: { value: 'Hello first' } })
    openReviewTab()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(editAsync).toHaveBeenCalledTimes(1))

    // The user keeps typing while the request is in flight. That text was not
    // in the request, so the successful response must not clear it.
    fireEvent.change(bodyEditor(), { target: { value: 'Hello second' } })
    await act(async () => {
      resolveFirst({
        documentId: 'doc_1',
        versionId: 'ver_2',
        versionNumber: 2,
      })
    })

    await waitFor(() => expect(saveState()).toBe('unsaved'))
    expect(bodyEditor().value).toBe('Hello second')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(editAsync).toHaveBeenCalledTimes(2))
    expect(editAsync.mock.calls[1]?.[0].operations).toEqual([
      { type: 'replace_run_text', runId: 'r1', text: 'Hello second' },
    ])
  })

  it('ignores a second save while the first is still in flight', async () => {
    const editAsync = vi.fn().mockResolvedValue({
      documentId: 'doc_1',
      versionId: 'ver_2',
      versionNumber: 2,
    })
    mount({ editAsync })
    fireEvent.click(screen.getByText('Hello'))
    fireEvent.change(bodyEditor(), { target: { value: 'Hello world' } })

    // Ctrl+S bypasses the disabled Save button.
    const shell = document.getElementById('document-workspace')
    if (!shell) throw new Error('expected the workspace shell')
    fireEvent.keyDown(shell, { key: 's', ctrlKey: true })
    fireEvent.keyDown(shell, { key: 's', ctrlKey: true })

    await waitFor(() => expect(editAsync).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(editAsync).toHaveBeenCalledTimes(1)
  })

  it('says a draft could not be stored when the browser refuses', async () => {
    const originalSetItem = Storage.prototype.setItem
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (this === window.localStorage) throw new Error('QuotaExceededError')
        originalSetItem.call(this, key, value)
      })
    try {
      mount({ editAsync: vi.fn() })
      fireEvent.click(screen.getByText('Hello'))
      fireEvent.change(bodyEditor(), { target: { value: 'Hello unstored' } })

      await waitFor(() => {
        expect(screen.getByText(/could not store a draft/i)).toBeTruthy()
      })
      expect(saveState()).toBe('unsaved')
    } finally {
      spy.mockRestore()
    }
  })

  it('explains that work is unsaved and offers a retry instead of a generic invalid-request message', async () => {
    const editAsync = vi.fn().mockRejectedValue(validationFailed)
    mount({ editAsync })
    fireEvent.click(screen.getByText('Hello'))
    fireEvent.change(bodyEditor(), { target: { value: 'Hello world' } })
    openReviewTab()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText(/have not been saved/i)).toBeTruthy()
    })
    expect(screen.getByText(/still in this tab/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry save' })).toBeTruthy()
    expect(saveState()).toBe('failed')
  })
})

describe('E45 unsaved drafts must survive a reload', () => {
  it('restores typed text after the workspace remounts', async () => {
    mount({ editAsync: vi.fn() })
    fireEvent.click(screen.getByText('Hello'))
    fireEvent.change(bodyEditor(), { target: { value: 'Hello restored' } })

    cleanup()
    mount({ editAsync: vi.fn() })
    fireEvent.click(screen.getByText('Hello restored'))

    await waitFor(() => {
      expect(bodyEditor().value).toBe('Hello restored')
    })
    expect(screen.getByText(/restored from this browser/i)).toBeTruthy()
    expect(saveState()).toBe('unsaved')
  })

  it('clears the stored draft once the server has committed it', async () => {
    const editAsync = vi.fn().mockResolvedValue({
      documentId: 'doc_1',
      versionId: 'ver_2',
      versionNumber: 2,
    })
    mount({ editAsync })
    fireEvent.click(screen.getByText('Hello'))
    fireEvent.change(bodyEditor(), { target: { value: 'Hello world' } })
    openReviewTab()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saveState()).toBe('saved'))

    cleanup()
    mount({ editAsync: vi.fn() })
    fireEvent.click(screen.getByText('Hello'))
    await waitFor(() => {
      expect(bodyEditor().value).toBe('Hello')
    })
  })

  it('does not apply a draft recorded against an older stored version', async () => {
    mount({ editAsync: vi.fn() })
    fireEvent.click(screen.getByText('Hello'))
    fireEvent.change(bodyEditor(), { target: { value: 'Hello stale' } })

    cleanup()
    mount({ editAsync: vi.fn(), versionId: 'ver_2', body: 'Hello' })
    fireEvent.click(screen.getByText('Hello'))

    await waitFor(() => {
      expect(bodyEditor().value).toBe('Hello')
    })
    expect(screen.getByText(/earlier version of this document/i)).toBeTruthy()
  })
})

function openReviewTab() {
  fireEvent.click(screen.getByRole('tab', { name: 'Review' }))
}
