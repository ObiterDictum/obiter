import '@obiter/test-dom'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DocumentPdfViewResponse } from '@obiter/contracts'
import type { MatterTab } from './matter-tabs'

const state = {
  tabs: [] as MatterTab[],
  fileType: 'pdf' as 'pdf' | 'txt',
  requests: [] as string[],
}

const tabsModule = { ...(await import('./matter-tabs-state')) }
mock.module('./matter-tabs-state', () => ({
  ...tabsModule,
  useMatterTabs: () => ({ tabs: state.tabs, swapSides: () => undefined }),
}))

const documentsModule = { ...(await import('./documents')) }
mock.module('./documents', () => ({
  ...documentsModule,
  useDocument: (documentId: string) =>
    documentId
      ? {
          isPending: false,
          data: {
            document: {
              id: documentId,
              currentVersion: {
                id: 'ver_side',
                filename: `claim-form.${state.fileType}`,
                fileType: state.fileType,
                versionNumber: 1,
              },
            },
          },
        }
      : { isPending: false, data: undefined },
}))

const { MatterSplitSide } = await import('./matter-split-side')

const pdfView: DocumentPdfViewResponse = {
  documentId: 'doc_side',
  versionId: 'ver_side',
  versionNumber: 1,
  text: 'PARTICULARS OF CLAIM',
  layout: {
    version: 1,
    pages: [{ width: 612, height: 792 }],
    segments: [
      {
        start: 0,
        end: 20,
        pageIndex: 0,
        x: 72,
        y: 720,
        width: 200,
        height: 12,
      },
    ],
  },
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function renderSide(sideId: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MatterSplitSide sideId={sideId} onClose={() => undefined} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  state.requests = []
  state.fileType = 'pdf'
  state.tabs = [
    {
      id: 'tab_side',
      kind: 'document',
      target: 'doc_side',
      title: 'claim-form',
    },
  ] as MatterTab[]
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        const url = String(input)
        state.requests.push(url)
        if (url.includes('/api/documents/doc_side/pdf-view'))
          return json(pdfView)
        if (url.includes('/api/documents/doc_side/text'))
          return json({ text: 'Plain text body of the note' })
        return json({ error: { code: 'not_found', message: 'Not found' } }, 404)
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  )
})

afterEach(() => {
  cleanup()
  mock.restore()
})

describe('MatterSplitSide', () => {
  it('shows a PDF opened to the side as its pages, not as an unreadable document', async () => {
    renderSide('tab_side')
    expect(await screen.findByText('PARTICULARS OF CLAIM')).toBeTruthy()
    expect(
      screen.queryByText('This document has no readable version yet.'),
    ).toBeNull()
    expect(state.requests.some((url) => url.includes('/model'))).toBe(false)
  })

  it('shows a text file opened to the side as its text', async () => {
    state.fileType = 'txt'
    renderSide('tab_side')
    expect(await screen.findByText('Plain text body of the note')).toBeTruthy()
    expect(state.requests.some((url) => url.includes('/model'))).toBe(false)
  })

  it('asks the API for nothing while no document is open to the side', async () => {
    state.tabs = []
    renderSide('tab_missing')
    expect(
      screen.getByText('Open a document to the side to compare it here.'),
    ).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(state.requests).toEqual([])
  })
})
