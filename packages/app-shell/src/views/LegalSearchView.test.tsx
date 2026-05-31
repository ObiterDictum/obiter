// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LEGAL_SEARCH_DEBOUNCE_MS, LegalSearchView } from './LegalSearchView'

interface DeferredResponse {
  promise: Promise<Response>
  resolve: (response: Response) => void
}

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

function createDeferredResponse(): DeferredResponse {
  let resolve: (response: Response) => void = () => {}
  const promise = new Promise<Response>((resolvePromise) => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}

function createSearchResponse(hits: unknown[] = []) {
  return {
    ok: true,
    json: async () => ({
      hits,
      cached: false,
      indexedCount: 0,
      skippedCount: 0,
    }),
  } as Response
}

function renderLegalSearchView() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  act(() => {
    root.render(<LegalSearchView />)
  })

  return { container, root }
}

function getSearchInput(container: HTMLElement) {
  const input = container.querySelector<HTMLInputElement>('input[name="query"]')
  if (!input) throw new Error('Search input was not rendered')
  return input
}

async function changeSearchInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setValue?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('LegalSearchView debounce lifecycle', () => {
  let root: Root | null
  let container: HTMLElement | null

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    window.sessionStorage.clear()
    root = null
    container = null
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
    }
    container?.remove()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('does not run a debounced search after the view unmounts', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await changeSearchInput(getSearchInput(container), 'Potanina')

    act(() => {
      root?.unmount()
      root = null
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps superseded responses from updating the search state', async () => {
    const firstSearch = createDeferredResponse()
    const secondSearch = createDeferredResponse()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(firstSearch.promise)
      .mockReturnValueOnce(secondSearch.promise)
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container
    const input = getSearchInput(container)

    await changeSearchInput(input, 'Potanina')

    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)

    await changeSearchInput(input, 'Potanin')
    firstSearch.resolve(createSearchResponse())
    await flushMicrotasks()

    expect(container.textContent).not.toContain('No stored legal sources matched "Potanina"')

    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    secondSearch.resolve(createSearchResponse())
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('No stored legal sources matched "Potanin"')
  })
})
