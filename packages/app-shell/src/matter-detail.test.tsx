// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { MatterRouteView } from './views/matters'
import type { MatterRecord } from './matters'

const mocks = vi.hoisted(() => ({
  useMatter: vi.fn(),
  useMatterDocuments: vi.fn(),
  useUploadMatterDocument: vi.fn(),
  useDeleteMatter: vi.fn(),
  useCurrentUser: vi.fn(),
  useNavigate: vi.fn(),
  useToast: vi.fn(),
}))

vi.mock('./matters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./matters')>()
  return {
    ...actual,
    useMatter: mocks.useMatter,
    useDeleteMatter: mocks.useDeleteMatter,
  }
})

vi.mock('./documents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./documents')>()
  return {
    ...actual,
    useMatterDocuments: mocks.useMatterDocuments,
    useUploadMatterDocument: mocks.useUploadMatterDocument,
  }
})

vi.mock('./current-user', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./current-user')>()
  return { ...actual, useCurrentUser: mocks.useCurrentUser }
})

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return { ...actual, useNavigate: mocks.useNavigate }
})

vi.mock('@obiter/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@obiter/ui')>()
  return { ...actual, useToast: mocks.useToast }
})

const OWNER = {
  user: { id: 'usr_1', email: 'lex@obiter.dev', name: 'Lex', role: 'owner' },
  organisation: { id: 'org_1', name: 'Obiter', plan: 'private_beta' },
}

const MEMBER = {
  user: {
    id: 'usr_2',
    email: 'junior@obiter.dev',
    name: 'Junior',
    role: 'member',
  },
  organisation: { id: 'org_1', name: 'Obiter', plan: 'private_beta' },
}

function sampleMatter(): MatterRecord {
  return {
    id: 'mtr_1',
    organisationId: 'org_1',
    name: 'Share purchase',
    description: null,
    primaryJurisdiction: 'england_and_wales',
    secondaryJurisdictions: [],
    legalDomains: [],
    clientReference: 'REF-1',
    status: 'active',
    createdBy: 'usr_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    deletedBy: null,
  }
}

function successMatter() {
  return {
    isLoading: false,
    isError: false,
    isSuccess: true,
    data: sampleMatter(),
  }
}

function noDocuments() {
  return { isLoading: false, isError: false, data: [] }
}

function loadingDocuments() {
  return { isLoading: true, isError: false, data: undefined }
}

function deleteMutationSpy() {
  const mutateAsync = vi.fn().mockResolvedValue(undefined)
  return { mutateAsync, isPending: false }
}

function buildRouter(matterId: string) {
  const rootRoute = createRootRoute()
  const matterRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/matters/$matterId',
    component: () => <MatterRouteView matterId={matterId} platform="web" />,
  })
  return createRouter({
    routeTree: rootRoute.addChildren([matterRoute]),
    history: createMemoryHistory({
      initialEntries: [`/matters/${matterId}`],
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useMatterDocuments.mockReturnValue(noDocuments())
  mocks.useUploadMatterDocument.mockReturnValue({ mutate: vi.fn() })
  mocks.useNavigate.mockReturnValue(vi.fn())
  mocks.useToast.mockReturnValue({ toast: vi.fn() })
})

afterEach(() => {
  cleanup()
})

describe('MatterRouteView delete affordance', () => {
  it('renders a delete control for an owner and fires the delete mutation', async () => {
    mocks.useMatter.mockReturnValue(successMatter())
    mocks.useCurrentUser.mockReturnValue({ data: OWNER })
    const deleteSpy = deleteMutationSpy()
    mocks.useDeleteMatter.mockReturnValue(deleteSpy)

    render(<RouterProvider router={buildRouter('mtr_1')} />)

    await waitFor(() => {
      expect(screen.getByText('Share purchase')).toBeTruthy()
    })
    const deleteButtons = screen.getAllByRole('button', {
      name: 'Delete matter',
    })
    expect(deleteButtons.length).toBe(1)

    // Open the dialog; the confirmation copy states the cascade.
    deleteButtons[0].click()
    await waitFor(() => {
      expect(screen.getByText(/removes 0 documents/i)).toBeTruthy()
    })

    // Confirm (the destructive button) fires the mutation.
    const confirm = screen.getByRole('button', { name: 'Delete matter' })
    confirm.click()
    await waitFor(() => {
      expect(deleteSpy.mutateAsync).toHaveBeenCalledWith('mtr_1')
    })
  })

  it('waits for the document count before enabling confirmation', async () => {
    mocks.useMatter.mockReturnValue(successMatter())
    mocks.useMatterDocuments.mockReturnValue(loadingDocuments())
    mocks.useCurrentUser.mockReturnValue({ data: OWNER })
    mocks.useDeleteMatter.mockReturnValue(deleteMutationSpy())

    render(<RouterProvider router={buildRouter('mtr_1')} />)

    await waitFor(() => {
      expect(screen.getByText('Share purchase')).toBeTruthy()
    })
    screen.getByRole('button', { name: 'Delete matter' }).click()

    await waitFor(() => {
      expect(
        screen.getByText('Loading the document count before deletion.'),
      ).toBeTruthy()
    })
    const confirm = screen.getByRole('button', { name: 'Delete matter' })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
  })

  it('accepts DOCX, PDF, and TXT documents for text extraction', async () => {
    mocks.useMatter.mockReturnValue(successMatter())
    mocks.useCurrentUser.mockReturnValue({ data: OWNER })
    mocks.useDeleteMatter.mockReturnValue(deleteMutationSpy())

    render(<RouterProvider router={buildRouter('mtr_1')} />)

    await waitFor(() => {
      expect(screen.getByText('DOCX, PDF, and TXT, up to 25 MB')).toBeTruthy()
    })
    const input = screen.getByLabelText('Upload document')
    expect(input).toHaveProperty('accept', expect.stringContaining('.pdf'))
  })

  it('hides the delete control for a member', async () => {
    mocks.useMatter.mockReturnValue(successMatter())
    mocks.useCurrentUser.mockReturnValue({ data: MEMBER })
    mocks.useDeleteMatter.mockReturnValue(deleteMutationSpy())

    render(<RouterProvider router={buildRouter('mtr_1')} />)

    await waitFor(() => {
      expect(screen.getByText('Share purchase')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: 'Delete matter' })).toBeNull()
  })
})
