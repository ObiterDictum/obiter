// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LEGAL_SEARCH_DEBOUNCE_MS, LegalSearchView } from './LegalSearchView'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    className,
  }: {
    children: ReactNode
    className?: string
  }) => <a className={className}>{children}</a>,
}))

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

async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setValue?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function clickButton(container: HTMLElement, name: string) {
  const button = [...container.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(name) || candidate.getAttribute('aria-label')?.includes(name),
  )
  if (!button) throw new Error(`Button not found: ${name}`)

  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
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

  it('runs a stored-only court browse when a court shortcut has no query', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      createSearchResponse([
        {
          id: 'uksc-2024-3',
          title: 'Potanina v Potanin',
          neutralCitation: '[2024] UKSC 3',
          court: 'uksc',
          dateDecided: '2024-01-31',
          sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2024/3',
        },
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    expect(container.textContent).toContain('Recent searches')
    expect(container.textContent).toContain('Case name')
    expect(container.textContent).toContain('Neutral citation')
    expect(container.textContent).toContain('Keyword')

    await clickButton(container, 'UKSC')
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    expect(JSON.parse(String(request?.body))).toEqual({
      query: '',
      foregroundLiveResults: false,
      court: 'uksc',
    })
    expect(container.textContent).toContain('Potanina v Potanin')
  })

  it('runs shortcut searches with a supported court filter', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(createSearchResponse())
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container
    const input = getSearchInput(container)

    await clickButton(container, 'EWHC Admin')
    await changeSearchInput(input, 'Miah')
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    expect(JSON.parse(String(request?.body))).toMatchObject({
      query: 'Miah',
      court: 'ewhc/admin',
      foregroundLiveResults: true,
    })
  })

  it('stores successful non-empty searches as recent idle shortcuts', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(createSearchResponse())
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container
    const input = getSearchInput(container)

    await changeSearchInput(input, 'Potanina')
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    await changeSearchInput(input, '')

    expect(container.textContent).toContain('Potanina')
  })

  it('removes one active filter while preserving the others through stored-only browse', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(createSearchResponse())
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await clickButton(container, 'UKSC')
    await clickButton(container, 'Filters')

    const dateFromInput = container.querySelector<HTMLInputElement>('input[name="date-from-filter"]')
    const dateToInput = container.querySelector<HTMLInputElement>('input[name="date-to-filter"]')
    if (!dateFromInput || !dateToInput) throw new Error('Date filters were not rendered')

    await changeInput(dateFromInput, '2024-01-01')
    await changeInput(dateToInput, '2024-12-31')
    await clickButton(container, 'Apply filters')

    expect(container.textContent).toContain('Supreme Court')
    expect(container.textContent).toContain('From 2024-01-01')
    expect(container.textContent).toContain('To 2024-12-31')

    await clickButton(container, 'Remove from 2024-01-01 filter')
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    expect(JSON.parse(String(request?.body))).toEqual({
      query: '',
      foregroundLiveResults: false,
      court: 'uksc',
      dateTo: '2024-12-31',
    })
    expect(container.textContent).toContain('Supreme Court')
    expect(container.textContent).not.toContain('From 2024-01-01')
    expect(container.textContent).toContain('To 2024-12-31')
  })
})
