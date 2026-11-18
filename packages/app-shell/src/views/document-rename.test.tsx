import '@obiter/test-dom'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster, ToastProvider } from '@obiter/ui'
import type { ReactNode } from 'react'
import type { MatterDocumentRecord } from '../documents'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
const apiModule = { ...(await import('../api')) }
mock.module('../api', () => ({ ...apiModule, apiFetch: api.apiFetch }))

const { ApiError } = apiModule
const { documentDisplayName, documentsKeys } = await import('../documents')
const { DocumentTitle } =
  await import('../components/document-workspace/document-title')
const { DocumentRowMenu } = await import('./document-row-menu')

function sampleDocument(): MatterDocumentRecord {
  return {
    id: 'doc_1',
    organisationId: 'org_1',
    matterId: 'mtr_1',
    currentVersionId: 'ver_1',
    logicalKey: 'logical',
    name: 'First draft',
    createdBy: 'usr_1',
    createdAt: '2026-11-18T10:00:00.000Z',
    updatedAt: '2026-11-18T10:00:00.000Z',
    deletedAt: null,
    deletedBy: null,
    currentVersion: {
      id: 'ver_1',
      organisationId: 'org_1',
      matterId: 'mtr_1',
      matterDocumentId: 'doc_1',
      filename: 'Untitled document.docx',
      fileType: 'docx',
      sizeBytes: '10',
      objectKey: 'key',
      textObjectKey: null,
      documentStatus: 'ready',
      failureReason: null,
      versionNumber: 1,
      contentSha256: 'sha',
      syncState: 'synced',
      createdBy: 'usr_1',
      createdAt: '2026-11-18T10:00:00.000Z',
      updatedAt: '2026-11-18T10:00:00.000Z',
    },
  }
}

function renamed(name: string) {
  return {
    document: { id: 'doc_1', name, updatedAt: '2026-11-18T11:00:00.000Z' },
  }
}

function renderWith(node: ReactNode) {
  const client = new QueryClient()
  client.setQueryData(documentsKeys.byMatter('mtr_1'), [sampleDocument()])
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        {node}
        <Toaster />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return client
}

function TitleFromCache() {
  return <DocumentTitle document={sampleDocument()} />
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(cleanup)

describe('document display name', () => {
  it('shows the stored name with the current version file type', () => {
    expect(documentDisplayName(sampleDocument())).toBe('First draft.docx')
    expect(documentDisplayName({ ...sampleDocument(), name: null })).toBe(
      'Untitled document.docx',
    )
  })
})

describe('inline title rename', () => {
  it('edits the name without its extension on F2 and saves on Enter', async () => {
    api.apiFetch.mockResolvedValue(renamed('Skeleton argument'))
    const client = renderWith(<TitleFromCache />)

    const title = screen.getByRole('button', { name: 'First draft.docx' })
    fireEvent.keyDown(title, { key: 'F2' })
    const input = screen.getByRole('textbox', { name: 'Document name' })
    expect((input as HTMLInputElement).value).toBe('First draft')
    expect(screen.getByText('.docx')).toBeTruthy()

    fireEvent.change(input, { target: { value: ' Skeleton argument ' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)

    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith('/api/documents/doc_1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Skeleton argument' }),
      }),
    )
    expect(await screen.findByText('Document renamed')).toBeTruthy()
    expect(
      client
        .getQueryData<MatterDocumentRecord[]>(documentsKeys.byMatter('mtr_1'))
        ?.at(0)?.name,
    ).toBe('Skeleton argument')
  })

  it('cancels on Escape without calling the API', () => {
    renderWith(<TitleFromCache />)
    fireEvent.click(screen.getByRole('button', { name: 'First draft.docx' }))
    const input = screen.getByRole('textbox', { name: 'Document name' })
    fireEvent.change(input, { target: { value: 'Abandoned' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Document name' })).toBeNull()
    expect(
      screen.getByRole('button', { name: 'First draft.docx' }),
    ).toBeTruthy()
    expect(api.apiFetch).not.toHaveBeenCalled()
  })

  it('keeps the editor open with a visible error when the API refuses', async () => {
    api.apiFetch.mockRejectedValue(
      new ApiError('document_not_found', 'Document not found.', 404, 'req'),
    )
    renderWith(<TitleFromCache />)
    fireEvent.click(screen.getByRole('button', { name: 'First draft.docx' }))
    const input = screen.getByRole('textbox', { name: 'Document name' })
    fireEvent.change(input, { target: { value: 'Not allowed' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    expect((await screen.findByRole('alert')).textContent).toContain(
      'you may not have edit access',
    )
    expect(screen.getByRole('textbox', { name: 'Document name' })).toBeTruthy()
  })

  it('refuses an invalid name before calling the API', async () => {
    renderWith(<TitleFromCache />)
    fireEvent.click(screen.getByRole('button', { name: 'First draft.docx' }))
    const input = screen.getByRole('textbox', { name: 'Document name' })
    fireEvent.change(input, { target: { value: 'a/b' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Names cannot contain slashes or control characters.',
    )
    expect(api.apiFetch).not.toHaveBeenCalled()
  })
})

describe('document list rename', () => {
  it('renames from the row menu dialog', async () => {
    api.apiFetch.mockResolvedValue(renamed('Skeleton argument'))
    renderWith(<DocumentRowMenu document={sampleDocument()} />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Actions for First draft.docx' }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: /Rename/ }))
    const input = await screen.findByRole('textbox', { name: 'Name' })
    expect((input as HTMLInputElement).value).toBe('First draft')
    fireEvent.change(input, { target: { value: 'Skeleton argument' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)

    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith('/api/documents/doc_1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Skeleton argument' }),
      }),
    )
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull(),
    )
  })

  it('shows the refusal inside the dialog', async () => {
    api.apiFetch.mockRejectedValue(
      new ApiError('validation_failed', 'Enter a document name.', 400, 'req'),
    )
    renderWith(<DocumentRowMenu document={sampleDocument()} />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Actions for First draft.docx' }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: /Rename/ }))
    const input = await screen.findByRole('textbox', { name: 'Name' })
    fireEvent.change(input, { target: { value: 'Other' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    expect(await screen.findByText('Enter a document name.')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy()
  })
})
