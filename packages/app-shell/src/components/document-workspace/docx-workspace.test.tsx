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
  }
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

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DocxWorkspace save', () => {
  it('surfaces a reload banner when save hits a stale-base 409', async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValue(
        new ApiError(
          'conflict_detected',
          'The document has changed since editing began.',
          409,
          'req_1',
        ),
      )
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
    hooks.useEditDocument.mockReturnValue(idleMutation({ mutateAsync }))
    hooks.useCollaborationMerge.mockReturnValue(idleMutation())
    hooks.useTrackedChangeDecision.mockReturnValue(idleMutation())
    hooks.usePresenceUpdate.mockReturnValue(idleMutation())

    render(
      <DocxWorkspace
        documentId="doc_1"
        versionId="ver_1"
        filename="brief.docx"
      />,
      {
        wrapper,
      },
    )

    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    const input = screen.getByLabelText('Paragraph text')
    fireEvent.change(input, { target: { value: 'Hello world' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(
        screen.getByText('The document has changed since editing began.'),
      ).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    expect(mutateAsync).toHaveBeenCalled()
  })
})
