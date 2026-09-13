// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LEGAL_SEARCH_DEBOUNCE_MS,
  LEGAL_SEARCH_HYDRATION_MAX_POLLS,
  LEGAL_SEARCH_HYDRATION_POLL_MS,
  LegalSearchView,
} from './LegalSearchView'

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => routerMocks.navigate,
  Link: ({
    children,
    className,
    to,
    params,
    href,
    ...props
  }: {
    children: ReactNode
    className?: string
    to?: string
    params?: Record<string, string>
    href?: string
    [key: string]: unknown
  }) => {
    const resolvedHref =
      href ??
      (typeof to === 'string'
        ? to.replace(
            /\$([A-Za-z0-9_]+)/g,
            (_, key: string) => params?.[key] ?? '',
          )
        : undefined)
    return (
      <a className={className} href={resolvedHref} {...props}>
        {children}
      </a>
    )
  },
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

function createSearchResponse(
  hits: unknown[] = [],
  options: {
    cached?: boolean
    outcome?: string
    hydrationQueued?: boolean
    liveProviderSearched?: boolean
  } = {},
) {
  return {
    ok: true,
    json: async () => ({
      hits,
      cached: options.cached ?? false,
      indexedCount: 0,
      skippedCount: 0,
      ...(options.outcome ? { outcome: options.outcome } : {}),
      ...(options.hydrationQueued !== undefined
        ? { hydrationQueued: options.hydrationQueued }
        : {}),
      ...(options.liveProviderSearched !== undefined
        ? {
            diagnostics: {
              liveProviderSearched: options.liveProviderSearched,
            },
          }
        : {}),
    }),
  } as Response
}

/**
 * The JSON body of a search response, loose enough for a test to assemble
 * only the fields the assertion needs.
 */
interface SearchResponseBody {
  hits: unknown[]
  cached: boolean
  indexedCount: number
  skippedCount: number
  outcome?: string
  hydrationQueued?: boolean
  diagnostics?: Record<string, unknown>
}

function createTwoResultHits() {
  return [
    {
      id: 'uksc-2024-3',
      title: 'Potanina v Potanin',
      neutralCitation: '[2024] UKSC 3',
      court: 'uksc',
      dateDecided: '2024-01-31',
      sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2024/3',
      canonicalUrl: '/case/potanina-v-potanin-2024-uksc-3',
      matchReason: 'exact_neutral_citation',
      retrievalPath: 'stored_index',
      retrievalRank: 1,
      retrievalScore: 0.95,
    },
    {
      id: 'ewca-2023-1',
      title: 'Example v Respondent',
      neutralCitation: '[2023] EWCA Civ 1',
      court: 'ewca/civ',
      dateDecided: '2023-01-01',
      sourceUrl: 'https://caselaw.nationalarchives.gov.uk/ewca/civ/2023/1',
      canonicalUrl: '/case/example-v-respondent-2023-ewca-civ-1',
      matchReason: 'title_match',
      retrievalPath: 'stored_source',
      retrievalRank: 2,
      retrievalScore: 0.8,
    },
  ]
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
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set
    setValue?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set
    setValue?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function findButton(container: HTMLElement, name: string) {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) =>
      candidate.textContent?.includes(name) ||
      candidate.getAttribute('aria-label')?.includes(name),
  )
  if (!button) throw new Error(`Button not found: ${name}`)
  return button
}

async function clickButton(container: HTMLElement, name: string) {
  const button = findButton(container, name)

  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function submitSearchForm(container: HTMLElement) {
  const form = container.querySelector('form')
  if (!form) throw new Error('Search form was not rendered')

  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve()
  })
}

async function pressKey(key: string, target: EventTarget = window) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}

describe('LegalSearchView debounce lifecycle', () => {
  let root: Root | null
  let container: HTMLElement | null

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    routerMocks.navigate.mockReset()
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

    expect(container.textContent).not.toContain(
      'No stored legal sources matched "Potanina"',
    )

    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    secondSearch.resolve(createSearchResponse())
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain(
      'Stored legal sources did not match "Potanin" with the selected filters. Providers were not consulted for this search.',
    )
  })

  it('runs a stored-only court browse when a court shortcut has no query', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      createSearchResponse(
        [
          {
            id: 'uksc-2024-3',
            title: 'Potanina v Potanin',
            neutralCitation: '[2024] UKSC 3',
            court: 'uksc',
            dateDecided: '2024-01-31',
            sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2024/3',
          },
        ],
        { cached: true },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    expect(container.textContent).toContain('Search judgments')
    expect(container.textContent).toContain('Case name')
    expect(container.textContent).toContain('Neutral citation')
    expect(container.textContent).toContain('Keyword')
    expect(container.textContent).toContain('Court shortcuts')

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
    expect(container.textContent).toContain(
      '1 recent case for UK Supreme Court',
    )
    expect(container.textContent).toContain('Potanina v Potanin')
  })

  it('renders the honest empty for a recognised citation no source holds', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({
        hits: [],
        cached: true,
        indexedCount: 0,
        skippedCount: 0,
        outcome: 'recognised_not_held',
        citation: { recognised: true, status: 'not_held' },
        diagnostics: { liveProviderSearched: true },
      }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await changeSearchInput(getSearchInput(container), '[2023] EWCA Civ 123')
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Citation not held')
    expect(container.textContent).toContain(
      'No judgment held for this citation',
    )
    expect(container.textContent).toContain(
      'No stored or provider source holds "[2023] EWCA Civ 123" as a judgment.',
    )
  })

  it('names the unheld Act instead of claiming a judgment was sought', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({
        hits: [],
        cached: true,
        indexedCount: 0,
        skippedCount: 0,
        outcome: 'recognised_not_held',
        citation: { recognised: true, status: 'not_held' },
        diagnostics: {
          liveProviderSearched: true,
          legislationNote: 'Children Act 1989 is not held.',
          legislationNotHeld: true,
        },
      }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await changeSearchInput(getSearchInput(container), 'Children Act 1989')
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    // The legislation half recognised the Act and served nothing: the panel
    // must name the Act, not report a missing judgment citation.
    expect(container.textContent).toContain('Legislation not held')
    expect(container.textContent).toContain('Children Act 1989 is not held.')
    expect(container.textContent).not.toContain('No judgment held')
  })

  it('surfaces an unresolved legislation title even when the outcome is no_match', async () => {
    // Finding 2: the signed-in foreground branch answered no_match without
    // consulting the legislation half, so this verdict vanished. The flag
    // must drive the copy regardless of the generic outcome.
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({
        hits: [],
        cached: true,
        indexedCount: 0,
        skippedCount: 0,
        outcome: 'no_match',
        diagnostics: {
          liveProviderSearched: true,
          legislationTitleUnresolved: true,
          legislationNote:
            'No exact legislation title match was found for "Children Act 1989".',
        },
      }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await changeSearchInput(getSearchInput(container), 'Children Act 1989')
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    expect(container.textContent).toContain('No exact legislation title match')
    expect(container.textContent).toContain('Children Act 1989')
    expect(container.textContent).not.toContain('No sources found')
    expect(container.textContent).not.toContain('is not held')
  })

  it('surfaces an ambiguous legislation title instead of a generic no-match', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({
        hits: [],
        cached: true,
        indexedCount: 0,
        skippedCount: 0,
        outcome: 'legislation_ambiguous',
        diagnostics: {
          liveProviderSearched: true,
          legislationAmbiguous: true,
          legislationNote:
            '“Sample Act 2020” names more than one stored Act. Candidates: Sample Act 2020; Sample Act 2020',
        },
      }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await changeSearchInput(getSearchInput(container), 'Sample Act 2020')
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    expect(container.textContent).toContain('More than one stored Act matches')
    expect(container.textContent).toContain('names more than one stored Act')
    expect(container.textContent).not.toContain('No sources found')
    expect(container.textContent).not.toContain('is not held')
  })

  it('keeps the legislation verdict through hydration expiry', async () => {
    // The bounded recheck path must not replace a legislation verdict with
    // "Still no match after rechecks".
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({
        hits: [],
        cached: true,
        indexedCount: 0,
        skippedCount: 0,
        outcome: 'legislation_title_unresolved',
        hydrationQueued: false,
        diagnostics: {
          liveProviderSearched: false,
          legislationTitleUnresolved: true,
          legislationNote:
            'No exact legislation title match was found for "Children Act 1989".',
        },
      }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await changeSearchInput(getSearchInput(container), 'Children Act 1989')
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    expect(container.textContent).toContain('No exact legislation title match')
    expect(container.textContent).not.toContain('Still no match after rechecks')
  })

  it('polls a queued verdict query and keeps the verdict after the poll expires', async () => {
    // Finding 2: the API now returns hydration_queued with the verdict in
    // diagnostics while a job is pending. The client must keep polling, and
    // when the bounded recheck expires it must show the legislation verdict,
    // not the generic "Still no match after rechecks" copy.
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({
        hits: [],
        cached: true,
        indexedCount: 0,
        skippedCount: 0,
        outcome: 'hydration_queued',
        hydrationQueued: true,
        diagnostics: {
          liveProviderSearched: false,
          legislationTitleUnresolved: true,
          legislationNote:
            'No exact legislation title match was found for "Children Act 1989".',
        },
      }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await changeSearchInput(getSearchInput(container), 'Children Act 1989')
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    // The verdict is visible while the poll runs.
    expect(container.textContent).toContain('No exact legislation title match')

    for (
      let attempt = 0;
      attempt < LEGAL_SEARCH_HYDRATION_MAX_POLLS;
      attempt++
    ) {
      await act(async () => {
        vi.advanceTimersByTime(LEGAL_SEARCH_HYDRATION_POLL_MS)
      })
      await flushMicrotasks()
    }

    expect(fetchMock).toHaveBeenCalledTimes(
      LEGAL_SEARCH_HYDRATION_MAX_POLLS + 1,
    )
    expect(container.textContent).toContain('No exact legislation title match')
    expect(container.textContent).not.toContain('Still no match after rechecks')
  })

  function scheduleGuidanceResponse(
    options: {
      outcome?: string
      hydrationQueued?: boolean
    } = {},
  ) {
    return {
      hits: [],
      cached: false,
      indexedCount: 0,
      skippedCount: 0,
      outcome: options.outcome ?? 'legislation_schedule_underspecified',
      hydrationQueued: options.hydrationQueued ?? false,
      diagnostics: {
        liveProviderSearched: true,
        legislationNote:
          'Sch. para. 2 of Equality Act 2010 names no schedule. Name the schedule to resolve it (for example "Schedule 1 paragraph 2").',
        legislationScheduleGuidance: {
          example: 'Schedule 1 paragraph 2',
          actTitle: 'Equality Act 2010',
        },
      },
    }
  }

  it('renders the underspecified-schedule corrective instead of a generic empty', async () => {
    // Browser finding: the API returned parser-compatible guidance, but the
    // signed-in UI showed the generic "No sources found" panel because the
    // structured diagnostic was dropped on the floor.
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => scheduleGuidanceResponse(),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await changeSearchInput(
      getSearchInput(container),
      'Sch. para. 2 Equality Act 2010',
    )
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    // The exact suggestion is visible as text, with the Act context needed
    // to resubmit it.
    expect(container.textContent).toContain('Schedule 1 paragraph 2')
    expect(container.textContent).toContain('Equality Act 2010')
    expect(container.textContent).not.toContain('No sources found')
    expect(container.textContent).not.toContain('is not held')
  })

  it('resubmits the displayed schedule example with its Act context', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => scheduleGuidanceResponse(),
      } as Response)
      .mockResolvedValueOnce(createSearchResponse([], { outcome: 'no_match' }))
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await changeSearchInput(
      getSearchInput(container),
      'Sch. para. 2 Equality Act 2010',
    )
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    await clickButton(container, 'Use this citation')
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const request = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined
    // The client must compose the query from the structured diagnostic, not
    // by parsing the human-readable note.
    expect(JSON.parse(String(request?.body))).toMatchObject({
      query: 'Schedule 1 paragraph 2 Equality Act 2010',
    })
  })

  it('keeps the schedule corrective while a hydration poll runs and after it expires', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () =>
        scheduleGuidanceResponse({
          outcome: 'hydration_queued',
          hydrationQueued: true,
        }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await changeSearchInput(
      getSearchInput(container),
      'Sch. para. 2 Equality Act 2010',
    )
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    // The corrective is visible while the poll runs, and the poll still runs.
    expect(container.textContent).toContain('Schedule 1 paragraph 2')
    expect(container.textContent).not.toContain('Still no match after rechecks')

    for (
      let attempt = 0;
      attempt < LEGAL_SEARCH_HYDRATION_MAX_POLLS;
      attempt++
    ) {
      await act(async () => {
        vi.advanceTimersByTime(LEGAL_SEARCH_HYDRATION_POLL_MS)
      })
      await flushMicrotasks()
    }

    expect(fetchMock).toHaveBeenCalledTimes(
      LEGAL_SEARCH_HYDRATION_MAX_POLLS + 1,
    )
    // Expiry must not swap the corrective for contradictory copy.
    expect(container.textContent).toContain('Schedule 1 paragraph 2')
    expect(container.textContent).not.toContain('Still no match after rechecks')
  })

  it('takes hydrated judgment results over the schedule corrective once they arrive', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          scheduleGuidanceResponse({
            outcome: 'hydration_queued',
            hydrationQueued: true,
          }),
      } as Response)
      .mockResolvedValueOnce(
        createSearchResponse(createTwoResultHits(), { outcome: 'results' }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await changeSearchInput(
      getSearchInput(container),
      'Sch. para. 2 Equality Act 2010',
    )
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_HYDRATION_POLL_MS)
    })
    await flushMicrotasks()

    expect(container.textContent).toContain('Potanina v Potanin')
  })

  it('tells signed-out users providers were not consulted on no_match', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({
        hits: [],
        cached: true,
        indexedCount: 0,
        skippedCount: 0,
        outcome: 'no_match',
        diagnostics: { liveProviderSearched: false },
      }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await changeSearchInput(getSearchInput(container), 'zxqwv neverseen')
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    expect(container.textContent).toContain('No sources found')
    expect(container.textContent).toContain(
      'Stored legal sources did not match "zxqwv neverseen"',
    )
    expect(container.textContent).toContain(
      'Providers were not consulted for this search.',
    )
    expect(container.textContent).not.toContain('Find Case Law did not match')
  })

  it('names Find Case Law when live was consulted and found nothing', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({
        hits: [],
        cached: false,
        indexedCount: 0,
        skippedCount: 0,
        outcome: 'no_match',
        hydrationQueued: false,
        diagnostics: { liveProviderSearched: true },
      }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await changeSearchInput(getSearchInput(container), 'zxqwv neverseen')
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    expect(container.textContent).toContain(
      'Stored legal sources and Find Case Law did not match "zxqwv neverseen"',
    )
    expect(container.textContent).not.toContain('were not consulted')
  })

  it('keeps stored-only copy for a citation live never checked', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({
        hits: [],
        cached: true,
        indexedCount: 0,
        skippedCount: 0,
        outcome: 'recognised_not_held',
        citation: { recognised: true, status: 'not_held' },
        diagnostics: { liveProviderSearched: false },
      }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await changeSearchInput(getSearchInput(container), '[2023] EWCA Civ 123')
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    expect(container.textContent).toContain('Citation not held')
    expect(container.textContent).toContain(
      'No stored legal source holds "[2023] EWCA Civ 123" as a judgment.',
    )
    expect(container.textContent).toContain('Providers were not consulted')
  })

  it('labels unsupported source types instead of no-match copy', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({
        hits: [],
        cached: true,
        indexedCount: 0,
        skippedCount: 0,
        outcome: 'unsupported_source_type',
      }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await changeSearchInput(getSearchInput(container), 'section 6')
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    expect(container.textContent).toContain(
      'This source type is not searchable yet',
    )
    expect(container.textContent).toContain(
      'Search currently covers judgments.',
    )
  })

  it('rechecks queued searches on a bound and expires plainly with retry', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({
        hits: [],
        cached: false,
        indexedCount: 0,
        skippedCount: 0,
        outcome: 'hydration_queued',
        hydrationQueued: true,
        diagnostics: { liveProviderSearched: false },
      }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await changeSearchInput(getSearchInput(container), 'zxqwv neverseen')
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    expect(container.textContent).toContain('Checking legal sources')
    expect(container.textContent).toContain(
      'Rechecking public legal sources automatically',
    )
    expect(container.textContent).toContain('Retry now')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_HYDRATION_POLL_MS)
    })
    await flushMicrotasks()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('check 2 of 6')

    for (let poll = 0; poll < LEGAL_SEARCH_HYDRATION_MAX_POLLS; poll += 1) {
      await act(async () => {
        vi.advanceTimersByTime(LEGAL_SEARCH_HYDRATION_POLL_MS)
      })
      await flushMicrotasks()
    }

    expect(container.textContent).toContain('Still no match after rechecks')
    expect(container.textContent).toContain('found nothing new')
    const callsAfterExpiry = fetchMock.mock.calls.length
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_HYDRATION_POLL_MS * 3)
    })
    await flushMicrotasks()
    expect(fetchMock.mock.calls.length).toBe(callsAfterExpiry)

    await clickButton(container, 'Retry search')
    await flushMicrotasks()
    expect(fetchMock.mock.calls.length).toBe(callsAfterExpiry + 1)
  })

  it('labels empty stored-only court browse without blank-query copy', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(createSearchResponse([], { cached: true }))
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await clickButton(container, 'UKSC')
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('No recent cases found')
    expect(container.textContent).toContain(
      'No recent stored cases found for UK Supreme Court.',
    )
    expect(container.textContent).not.toContain('matched ""')
  })

  it('runs shortcut searches with a supported court filter', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(createSearchResponse())
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
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(createSearchResponse())
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
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(createSearchResponse())
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await clickButton(container, 'UKSC')
    await clickButton(container, 'Filters')

    const dateFromInput = container.querySelector<HTMLInputElement>(
      'input[name="date-from-filter"]',
    )
    const dateToInput = container.querySelector<HTMLInputElement>(
      'input[name="date-to-filter"]',
    )
    if (!dateFromInput || !dateToInput)
      throw new Error('Date filters were not rendered')

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
  it('selects search results with keyboard navigation', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        createSearchResponse(createTwoResultHits(), { cached: true }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await changeSearchInput(getSearchInput(container), 'Potanina')
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    const resultLinks = () => [
      ...rendered.container.querySelectorAll<HTMLAnchorElement>(
        'a[href^="/case/"]',
      ),
    ]
    expect(resultLinks()[0]?.getAttribute('aria-current')).toBe('true')
    expect(resultLinks()[1]?.getAttribute('aria-current')).toBeNull()

    await pressKey('ArrowDown')

    expect(resultLinks()[0]?.getAttribute('aria-current')).toBeNull()
    expect(resultLinks()[1]?.getAttribute('aria-current')).toBe('true')

    await pressKey('ArrowUp')

    expect(resultLinks()[0]?.getAttribute('aria-current')).toBe('true')
    expect(resultLinks()[1]?.getAttribute('aria-current')).toBeNull()
  })

  it('does not treat j and k as result navigation while typing', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        createSearchResponse(createTwoResultHits(), { cached: true }),
      )
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
    await pressKey('j', input)

    const resultLinks = [
      ...container.querySelectorAll<HTMLAnchorElement>('a[href^="/case/"]'),
    ]
    expect(resultLinks[0]?.getAttribute('aria-current')).toBe('true')
    expect(resultLinks[1]?.getAttribute('aria-current')).toBeNull()
  })

  it('does not treat arrow keys as result navigation while typing', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        createSearchResponse(createTwoResultHits(), { cached: true }),
      )
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
    await pressKey('ArrowDown', input)

    const resultLinks = [
      ...container.querySelectorAll<HTMLAnchorElement>('a[href^="/case/"]'),
    ]
    expect(resultLinks[0]?.getAttribute('aria-current')).toBe('true')
    expect(resultLinks[1]?.getAttribute('aria-current')).toBeNull()
  })

  it('does not open the selected result when Enter is pressed in the search input', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        createSearchResponse(createTwoResultHits(), { cached: true }),
      )
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
    await pressKey('Enter', input)

    expect(routerMocks.navigate).not.toHaveBeenCalled()
  })

  it('uses canonical case URLs for result links and keyboard opening', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        createSearchResponse(createTwoResultHits(), { cached: true }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await changeSearchInput(getSearchInput(container), 'Potanina')
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    const firstResultLink =
      container.querySelector<HTMLAnchorElement>('a[href^="/case/"]')
    expect(firstResultLink?.getAttribute('href')).toBe(
      '/case/potanina-v-potanin-2024-uksc-3',
    )
    expect(container.textContent).toContain('Exact citation · stored index')

    await pressKey('Enter')

    expect(routerMocks.navigate).toHaveBeenCalledWith({
      to: '/case/$caseSlug',
      params: { caseSlug: 'potanina-v-potanin-2024-uksc-3' },
    })
  })

  it('names the wait on rate-limited search instead of a generic failure', async () => {
    // The API answers 429 hydration_budget_exceeded while background
    // hydration is over budget; the panel must say waiting, not failed.
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({
        error: {
          code: 'hydration_budget_exceeded',
          message: 'Search hydration budget exceeded. Try again later.',
          requestId: 'req_test',
        },
      }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await changeSearchInput(getSearchInput(container), 'Potanina')
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    expect(container.textContent).toContain('Search could not complete')
    expect(container.textContent).toContain(
      'Search is busy fetching new results. Try again shortly.',
    )
    expect(container.textContent).not.toContain(
      'Search could not complete the request.',
    )
  })

  it('names the search index when it is down instead of blaming the provider', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        error: {
          code: 'search_unavailable',
          message:
            'Legal search is temporarily unavailable because the search index cannot be reached. Try again later.',
          requestId: 'req_test',
        },
      }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await changeSearchInput(getSearchInput(container), 'Potanina')
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    expect(container.textContent).toContain(
      'Legal search is temporarily unavailable because the search index cannot be reached. Try again later.',
    )
    expect(container.textContent).not.toContain('Find Case Law')
  })

  it('keeps blaming Find Case Law for provider 503s', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        error: {
          code: 'storage_unavailable',
          message: 'Find Case Law is unavailable.',
          requestId: 'req_test',
        },
      }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await changeSearchInput(getSearchInput(container), 'Potanina')
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    expect(container.textContent).toContain(
      'Find Case Law is currently unreachable. Cached results may still be available through standard search.',
    )
  })

  it('opens and closes the keyboard shortcuts overlay', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await pressKey('?')

    expect(container.textContent).toContain('Keyboard Shortcuts')
    expect(container.textContent).toContain('ArrowDown / j')
    expect(document.activeElement).toBe(
      container.querySelector('[tabindex="-1"]'),
    )

    await pressKey('Escape')

    expect(container.textContent).not.toContain('Keyboard Shortcuts')
  })
})

describe('LegalSearchView interactive targets and query resync', () => {
  let root: Root | null
  let container: HTMLElement | null

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    routerMocks.navigate.mockReset()
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

  const underspecifiedQuery = 'Sch. para. 2 Equality Act 2010'
  const correctedQuery = 'Schedule 1 paragraph 2 Equality Act 2010'

  function scheduleGuidanceDiagnostics() {
    return {
      liveProviderSearched: true,
      legislationNote:
        'Sch. para. 2 of Equality Act 2010 names no schedule. Name the schedule to resolve it (for example "Schedule 1 paragraph 2").',
      legislationScheduleGuidance: {
        example: 'Schedule 1 paragraph 2',
        actTitle: 'Equality Act 2010',
      },
    }
  }

  // The schedule corrective renders above judgment results when the search
  // half answered, and inside the empty panel when it did not. Both carry the
  // same "Use this citation" button.
  function resultsWithScheduleGuidance(): SearchResponseBody {
    return {
      hits: [createTwoResultHits()[0]],
      cached: true,
      indexedCount: 0,
      skippedCount: 0,
      outcome: 'results',
      diagnostics: scheduleGuidanceDiagnostics(),
    }
  }

  function emptyWithScheduleGuidance(): SearchResponseBody {
    return {
      hits: [],
      cached: false,
      indexedCount: 0,
      skippedCount: 0,
      outcome: 'legislation_schedule_underspecified',
      hydrationQueued: false,
      diagnostics: scheduleGuidanceDiagnostics(),
    }
  }

  async function renderWithResponse(
    response: SearchResponseBody,
    query = underspecifiedQuery,
  ) {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => response,
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await changeSearchInput(getSearchInput(rendered.container), query)
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    return { fetchMock, ...rendered }
  }

  it('leaves Enter on the focused schedule resubmit button to the button', async () => {
    // Browser finding: the results-surface corrective renders while
    // `state.status === 'results'`, so the window keydown handler treated
    // Enter on the focused button as "open the selected result" and
    // suppressed the button's own activation.
    const { fetchMock, container: host } = await renderWithResponse(
      resultsWithScheduleGuidance(),
    )

    const button = findButton(host, 'Use this citation')
    await act(async () => {
      button.focus()
    })
    const requestsBeforeEnter = fetchMock.mock.calls.length

    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    await act(async () => {
      button.dispatchEvent(enter)
    })

    // Enter belongs to the button: not suppressed, and the selected result
    // row must not open instead.
    expect(enter.defaultPrevented).toBe(false)
    expect(routerMocks.navigate).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.length).toBe(requestsBeforeEnter)

    // jsdom does not synthesise the browser's Enter activation, so fire the
    // click the browser would: the resubmit happens exactly once.
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flushMicrotasks()
    expect(fetchMock.mock.calls.length).toBe(requestsBeforeEnter + 1)
  })

  it('leaves Space on the focused schedule resubmit button to the button', async () => {
    const { fetchMock, container: host } = await renderWithResponse(
      resultsWithScheduleGuidance(),
    )

    const button = findButton(host, 'Use this citation')
    await act(async () => {
      button.focus()
    })
    const requestsBeforeSpace = fetchMock.mock.calls.length

    const space = new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    })
    await act(async () => {
      button.dispatchEvent(space)
    })

    expect(space.defaultPrevented).toBe(false)
    expect(routerMocks.navigate).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.length).toBe(requestsBeforeSpace)

    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flushMicrotasks()
    expect(fetchMock.mock.calls.length).toBe(requestsBeforeSpace + 1)
  })

  it('ignores Enter from a descendant of an interactive result link', async () => {
    const { container: host } = await renderWithResponse(
      {
        hits: createTwoResultHits(),
        cached: true,
        indexedCount: 0,
        skippedCount: 0,
      },
      'Potanina',
    )

    const resultLink =
      host.querySelector<HTMLAnchorElement>('a[href^="/case/"]')
    const nested = resultLink?.querySelector('strong')
    expect(nested).toBeTruthy()

    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    await act(async () => {
      nested?.dispatchEvent(enter)
    })

    // A nested icon/span must not be mistaken for the non-interactive result
    // surface: the link owns Enter, the global shortcut stays out of it.
    expect(enter.defaultPrevented).toBe(false)
    expect(routerMocks.navigate).not.toHaveBeenCalled()
  })

  it('still opens the selected result from the non-interactive surface', async () => {
    await renderWithResponse(
      {
        hits: createTwoResultHits(),
        cached: true,
        indexedCount: 0,
        skippedCount: 0,
      },
      'Potanina',
    )

    // Focus is on the input, but the event target is the window itself — the
    // result-navigation surface the shortcut exists for.
    await pressKey('Enter')

    expect(routerMocks.navigate).toHaveBeenCalledWith({
      to: '/case/$caseSlug',
      params: { caseSlug: 'potanina-v-potanin-2024-uksc-3' },
    })
  })

  it('syncs the visible query when the results corrective resubmits', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => resultsWithScheduleGuidance(),
      } as Response)
      .mockResolvedValueOnce(createSearchResponse([], { outcome: 'no_match' }))
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await changeSearchInput(getSearchInput(container), underspecifiedQuery)
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    await clickButton(container, 'Use this citation')
    await flushMicrotasks()

    // One request for the corrective: syncing the input must not fire a
    // second, transient search of its own.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getSearchInput(container).value).toBe(correctedQuery)
    const resubmit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined
    expect(JSON.parse(String(resubmit?.body))).toMatchObject({
      query: correctedQuery,
    })

    // Enter in the input afterwards reruns the corrected query, not the
    // underspecified one the command bar used to show.
    await submitSearchForm(container)
    await flushMicrotasks()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const repeat = fetchMock.mock.calls[2]?.[1] as RequestInit | undefined
    expect(JSON.parse(String(repeat?.body))).toMatchObject({
      query: correctedQuery,
    })
  })

  it('syncs the visible query when the empty-state corrective resubmits', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => emptyWithScheduleGuidance(),
      } as Response)
      .mockResolvedValueOnce(createSearchResponse([], { outcome: 'no_match' }))
    vi.stubGlobal('fetch', fetchMock)
    const rendered = renderLegalSearchView()
    root = rendered.root
    container = rendered.container

    await changeSearchInput(getSearchInput(container), underspecifiedQuery)
    await act(async () => {
      vi.advanceTimersByTime(LEGAL_SEARCH_DEBOUNCE_MS)
    })
    await flushMicrotasks()

    await clickButton(container, 'Use this citation')
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getSearchInput(container).value).toBe(correctedQuery)
    const resubmit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined
    expect(JSON.parse(String(resubmit?.body))).toMatchObject({
      query: correctedQuery,
    })
  })
})
