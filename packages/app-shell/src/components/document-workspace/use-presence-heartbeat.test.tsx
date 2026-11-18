import '@obiter/test-dom'
import { afterEach, expect, it } from 'bun:test'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { vi } from '../../../../../scripts/test/vitest-compat'
import { startErrorReporting } from '../../error-reporting'
import { useDocumentPresenceHeartbeat } from './use-presence-heartbeat'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('starts after load, cancels superseded requests and stops on unmount without reporting aborts', async () => {
  const stopReporting = startErrorReporting('web', null, true)
  try {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
          if (!init?.signal) return new Response(null, { status: 204 })
          const signal = init.signal
          return new Promise<Response>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            })
          })
        },
        { preconnect: fetch.preconnect },
      ),
    )
    const interval = vi.spyOn(window, 'setInterval')
    const clearInterval = vi.spyOn(window, 'clearInterval')
    const client = new QueryClient()
    const cursor = { paragraphId: 'para_1', runId: 'run_1', offset: 0 }
    const { rerender, unmount } = renderHook<
      void,
      { documentId: string; versionId?: string }
    >(
      ({ documentId, versionId }: { documentId: string; versionId?: string }) =>
        useDocumentPresenceHeartbeat(documentId, cursor, versionId),
      {
        initialProps: { documentId: 'doc_1' },
        wrapper: ({ children }: PropsWithChildren) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    )
    expect(fetchMock).not.toHaveBeenCalled()

    rerender({ documentId: 'doc_1', versionId: 'ver_1' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const first = fetchMock.mock.calls[0]?.[1]?.signal
    const tick = interval.mock.calls.at(-1)?.[0]
    if (typeof tick !== 'function')
      throw new Error('Heartbeat timer was not installed')
    tick()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(first?.aborted).toBe(true)
    const second = fetchMock.mock.calls[1]?.[1]?.signal

    rerender({ documentId: 'doc_2', versionId: 'ver_2' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(second?.aborted).toBe(true)
    expect(fetchMock.mock.calls[2]?.[0]).toContain(
      '/api/documents/doc_2/collaboration/presence',
    )
    const third = fetchMock.mock.calls[2]?.[1]?.signal

    unmount()
    expect(third?.aborted).toBe(true)
    expect(clearInterval).toHaveBeenCalledTimes(2)
    await waitFor(() =>
      expect(
        client
          .getMutationCache()
          .getAll()
          .map((mutation) => mutation.state.status),
      ).toEqual(['success', 'success', 'success']),
    )
    window.dispatchEvent(new Event('pagehide'))
    expect(fetchMock).toHaveBeenCalledTimes(3)
  } finally {
    stopReporting()
  }
})
