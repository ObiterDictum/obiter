// @vitest-environment jsdom
import { Suspense, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import {
  LegislationActView,
  legislationActQueryOptions,
} from './LegislationActView'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    href,
    ...props
  }: {
    children: ReactNode
    to?: string
    params?: { _splat: string }
    href?: string
    [key: string]: unknown
  }) => (
    <a href={href ?? to} data-params={params?._splat} {...props}>
      {children}
    </a>
  ),
}))

const ACT_PAYLOAD = {
  act: {
    identity: 'ukpga/2010/15',
    title: 'Equality Act 2010',
    year: 2010,
    number: 15,
    chapter: '2010 c. 15',
    extent: 'E+W+S',
    officialUrl: 'https://www.legislation.gov.uk/ukpga/2010/15',
    sourceUrl: 'https://www.legislation.gov.uk/ukpga/2010/15',
    canonicalUrl: '/ln/ukpga/2010/15',
    totalCount: 6,
    withheldCount: 2,
    contents: [
      {
        label: 'Part 2',
        labelPath: 'part/2',
        href: '/ln/ukpga/2010/15/part/2',
        extent: 'E+W+S',
        withheld: false,
        kind: 'part',
        text: 'Equality: key concepts',
        children: [
          {
            label: 's. 9',
            labelPath: 'section/9',
            href: '/ln/ukpga/2010/15/section/9',
            extent: 'E+W+S',
            withheld: false,
            kind: 'P1',
            children: [],
          },
          {
            label: 's. 10',
            labelPath: 'section/10',
            href: '/ln/ukpga/2010/15/section/10',
            extent: 'E+W+S',
            withheld: false,
            kind: 'P1',
            children: [],
          },
          {
            label: 's. 13',
            labelPath: 'section/13',
            href: '/ln/ukpga/2010/15/section/13',
            extent: 'E+W+S',
            withheld: false,
            kind: 'P1',
            children: [],
          },
          {
            label: 's. 13A',
            labelPath: 'section/13A',
            href: '/ln/ukpga/2010/15/section/13A',
            extent: 'E+W+S',
            withheld: false,
            kind: 'P1',
            children: [],
          },
          {
            label: 's. 14',
            labelPath: 'section/14',
            href: '/ln/ukpga/2010/15/section/14',
            extent: 'E+W+S',
            withheld: true,
            kind: 'P1',
            children: [],
          },
        ],
      },
      {
        label: 'Schedule 2',
        labelPath: 'schedule/2',
        href: '/ln/ukpga/2010/15/schedule/2',
        extent: 'E+W+S',
        withheld: false,
        kind: 'schedule',
        text: 'Equality of terms',
        children: [
          {
            label: 'Sch. 2 para. 4',
            labelPath: 'schedule/2/paragraph/4',
            href: '/ln/ukpga/2010/15/schedule/2/paragraph/4',
            extent: 'E+W+S',
            withheld: true,
            kind: 'P1',
            children: [],
          },
        ],
      },
    ],
  },
}

const CLEAN_ACT_PAYLOAD = {
  act: {
    ...ACT_PAYLOAD.act,
    identity: 'ukpga/2020/1',
    title: 'European Union (Withdrawal Agreement) Act 2020',
    chapter: '2020 c. 1',
    totalCount: 1,
    withheldCount: 0,
    contents: [
      {
        label: 's. 1',
        labelPath: 'section/1',
        href: '/ln/ukpga/2020/1/section/1',
        extent: 'E+W+S+N.I.',
        withheld: false,
        kind: 'P1',
        children: [],
      },
    ],
  },
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

function renderView(identity: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<div>Loading</div>}>
        <LegislationActView identity={identity} />
      </Suspense>
    </QueryClientProvider>,
  )
}

describe('LegislationActView', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('ukpga/2020/1')) return jsonResponse(CLEAN_ACT_PAYLOAD)
        if (url.includes('ukpga/2010/15')) return jsonResponse(ACT_PAYLOAD)
        return jsonResponse({}, false, 404)
      }),
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows the header, accurate withheld summary, and hierarchy', async () => {
    renderView('ukpga/2010/15')
    await waitFor(() => {
      expect(screen.getByText('Equality Act 2010')).toBeTruthy()
    })
    // Chapter appears as the eyebrow and in the definition list.
    expect(screen.getAllByText('2010 c. 15')).toHaveLength(2)
    // Accurate against the payload: 2 of 6 content rows withheld. The
    // Part and Schedule headings are never counted.
    expect(screen.getByText('2 of 6 provisions are not shown')).toBeTruthy()
    // Heading rows render for containers, with their heading text.
    expect(screen.getByText('Part 2')).toBeTruthy()
    expect(screen.getByText('Equality: key concepts')).toBeTruthy()
    expect(screen.getByText('Schedule 2')).toBeTruthy()
    expect(screen.getByText('Equality of terms')).toBeTruthy()
    // Document order preserved inside Part 2: s. 10 after s. 9, inserted
    // s. 13A kept between ss. 13 and 14 rather than sorted. Headings are
    // divs, so the leaf order comes from the provision-status links.
    const labels = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('data-legislation-status'))
      .map((link) => link.querySelector('strong')?.textContent)
    expect(labels).toEqual([
      's. 9',
      's. 10',
      's. 13',
      's. 13A',
      's. 14',
      'Sch. 2 para. 4',
    ])
    // The schedule paragraph is a leaf link nested under the schedule.
    expect(
      screen.getByText('Sch. 2 para. 4').closest('a')?.getAttribute('href'),
    ).toBe('/ln/ukpga/2010/15/schedule/2/paragraph/4')
    // Withheld entry stays listed and links to its provision page.
    const withheldLink = screen.getByText('s. 14').closest('a')
    expect(withheldLink?.getAttribute('href')).toBe(
      '/ln/ukpga/2010/15/section/14',
    )
    expect(withheldLink?.getAttribute('data-legislation-status')).toBe(
      'amended_not_held',
    )
    expect(
      screen.getByRole('link', { name: 'Official text' }).getAttribute('href'),
    ).toBe('https://www.legislation.gov.uk/ukpga/2010/15')
  })

  it('omits the withheld summary when nothing is withheld', async () => {
    renderView('ukpga/2020/1')
    await waitFor(() => {
      expect(
        screen.getByText('European Union (Withdrawal Agreement) Act 2020'),
      ).toBeTruthy()
    })
    expect(screen.queryByText(/are not shown/)).toBeNull()
    expect(screen.getByText('s. 1').closest('a')?.getAttribute('href')).toBe(
      '/ln/ukpga/2020/1/section/1',
    )
    expect(
      screen.getByText('Contents · 1 provision in document order'),
    ).toBeTruthy()
  })

  it('encodes each identity segment in the request URL', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(jsonResponse(ACT_PAYLOAD))
    const identity = 'ukpga/2010/15 A'
    const options = legislationActQueryOptions(identity)
    if (!options.queryFn) throw new Error('expected queryFn to be defined')
    await options.queryFn({} as never)
    const requestedUrl = fetchMock.mock.calls.at(-1)?.[0] as string
    expect(requestedUrl).toContain('/api/search/legislation/ukpga/2010/15%20A')
    expect(options.queryKey).toEqual(['legislation-act', identity])
  })
})
