import '@obiter/test-dom'
import {
  Suspense,
  type ComponentType,
  type AnchorHTMLAttributes,
  type ReactNode,
} from 'react'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { ToastProvider } from '@obiter/ui'

function linkHref(
  to: string | undefined,
  params: ({ _splat?: string } & Record<string, string>) | undefined,
  hash: string | undefined,
) {
  const path = (to ?? '')
    .replace(/\/\$$/, `/${params?._splat ?? ''}`)
    .replace(/\$([A-Za-z0-9_]+)/g, (_, key: string) => params?.[key] ?? '')
  return `${path}${hash ? `#${hash}` : ''}`
}

const tanstackReactRouterModuleKeys = Object.fromEntries(
  Object.keys(await import('@tanstack/react-router')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('@tanstack/react-router', () =>
  Object.assign(
    { ...tanstackReactRouterModuleKeys },
    (() => ({
      createLink:
        (Anchor: ComponentType<AnchorHTMLAttributes<HTMLAnchorElement>>) =>
        ({
          hash,
          hashScrollIntoView: _scroll,
          resetScroll: _reset,
          preload: _preload,
          to,
          params,
          ...props
        }: AnchorHTMLAttributes<HTMLAnchorElement> & {
          hash?: string
          hashScrollIntoView?: boolean
          resetScroll?: boolean
          preload?: boolean
          to?: string
          params?: { _splat: string }
        }) => (
          <Anchor
            {...props}
            href={linkHref(to, params, hash)}
            aria-current="page"
          />
        ),
      Link: ({
        children,
        to,
        params,
        hash,
        hashScrollIntoView: _hashScrollIntoView,
        resetScroll: _resetScroll,
        ...props
      }: {
        children: ReactNode
        to?: string
        params?: { _splat: string }
        hash?: string
        [key: string]: unknown
      }) => (
        <a href={linkHref(to, params, hash)} {...props}>
          {children}
        </a>
      ),
    }))(),
  ),
)

const { LegislationActView, legislationActQueryOptions } =
  await import('./LegislationActView')

const identity = 'ukpga/2025/1'
const canonicalUrl = `/ln/${identity}`
const officialUrl = `https://www.legislation.gov.uk/${identity}`

function contentsNode(
  labelPath: string,
  label: string,
  kind: 'part' | 'chapter' | 'crossheading' | 'schedule' | 'P1',
  docOrder: number,
) {
  return {
    label,
    docOrder,
    labelPath,
    href: `${canonicalUrl}/${labelPath}`,
    extent: 'E+W',
    withheld: false,
    kind,
    children: [],
  }
}

const sections = Array.from({ length: 60 }, (_, index) => ({
  ...contentsNode(`section/${index + 1}`, `s. ${index + 1}`, 'P1', index + 3),
  heading: `Section heading ${index + 1}`,
}))
const schedule = contentsNode(
  'schedule/1/paragraph/1',
  'Sch. 1 para. 1',
  'P1',
  64,
)
const part = {
  ...contentsNode('part/1', 'Part 1', 'part', 0),
  text: 'General provisions',
}
const chapter = contentsNode('part/1/chapter/1', 'Chapter 1', 'chapter', 1)
const crossheading = contentsNode(
  'crossheading/duties',
  'Duties',
  'crossheading',
  2,
)
const scheduleHeading = contentsNode('schedule/1', 'Schedule 1', 'schedule', 63)
const act = {
  identity,
  title: 'Example Act 2025',
  year: 2025,
  number: 1,
  chapter: '2025 c. 1',
  extent: 'E+W',
  canonicalUrl,
  officialUrl,
  sourceUrl: officialUrl,
  totalCount: 61,
  withheldCount: 1,
  repealedCount: 1,
  contents: [
    {
      ...part,
      children: [
        { ...chapter, children: [{ ...crossheading, children: sections }] },
      ],
    },
    { ...scheduleHeading, children: [schedule] },
  ],
}

const entries = [
  part,
  chapter,
  crossheading,
  ...sections,
  scheduleHeading,
  schedule,
].map((node) => {
  const labelPath = node.labelPath
  if (node.kind !== 'P1') return { labelPath }
  const links = {
    officialUrl: `${officialUrl}/${labelPath}`,
    canonicalUrl: node.href,
  }
  if (labelPath === 'section/2') {
    return {
      labelPath,
      provision: {
        ...links,
        legislationStatus: 'amended_not_held',
        notice: 'Recorded amendments have yet to be applied.',
        text: 'Stored wording of s. 2',
      },
    }
  }
  if (labelPath === 'section/3') {
    return {
      labelPath,
      provision: {
        ...links,
        legislationStatus: 'repealed',
        repealedFrom: '2025-04-01',
        notice: 'The provision has been repealed.',
      },
    }
  }
  return {
    labelPath,
    provision: {
      ...links,
      legislationStatus: 'current',
      text: `Wording of ${node.label}`,
      subsections:
        labelPath === 'section/1'
          ? [
              {
                label: 's. 1(1)',
                labelPath: 'section/1/1',
                href: `${canonicalUrl}/section/1/1`,
                legislationStatus: 'current',
                text: 'Wording of the first subsection.',
                children: [],
              },
            ]
          : undefined,
    },
  }
})

function renderView(hash = '') {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
  return render(
    <ToastProvider>
      <QueryClientProvider client={client}>
        <Suspense fallback={<div>Loading</div>}>
          <LegislationActView identity={identity} hash={hash} />
        </Suspense>
      </QueryClientProvider>
    </ToastProvider>,
  )
}

const scrollIntoView = mock(() => {})
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: scrollIntoView,
})

describe('LegislationActView', () => {
  beforeEach(() => {
    scrollIntoView.mockClear()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(input, 'http://localhost')
        if (!url.pathname.endsWith('/text')) return Response.json({ act })
        const offset = Number(url.searchParams.get('offset'))
        const limit = Number(url.searchParams.get('limit'))
        return Response.json({
          entries: entries.slice(offset, offset + limit),
          nextOffset: offset + limit < entries.length ? offset + limit : null,
        })
      }),
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('reads the hierarchy and wording in order, including outdated wording and repeal', async () => {
    renderView()
    const text = within(await screen.findByRole('region', { name: 'Act text' }))
    await text.findByText('Wording of s. 1')
    expect(
      text
        .getAllByRole('heading')
        .slice(0, 4)
        .map((heading) => heading.tagName),
    ).toEqual(['H2', 'H3', 'H4', 'H5'])
    expect(text.getByText('Wording of the first subsection.')).toBeTruthy()
    expect(
      text
        .getByRole('link', { name: 'Open provision s. 1' })
        .getAttribute('href'),
    ).toBe(`${canonicalUrl}/section/1`)
    expect(text.getByText('Stored wording of s. 2')).toBeTruthy()
    expect(
      text.getByText(/Recorded amendments have yet to be applied\./),
    ).toBeTruthy()
    expect(
      text
        .getByRole('link', { name: 'Read the official revised version' })
        .getAttribute('href'),
    ).toBe(`${officialUrl}/section/2`)
    expect(text.queryByText('Wording of s. 3')).toBeNull()
    expect(text.getByText('Repealed from 1 Apr 2025')).toBeTruthy()
    expect(
      text
        .getByRole('link', { name: 'Read the official record' })
        .getAttribute('href'),
    ).toBe(`${officialUrl}/section/3`)
    expect(screen.getByText('Point-in-time date not recorded')).toBeTruthy()
    expect(
      screen.getByText(/1 of 61 provisions may not be up to\s+date/),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Contents' }))
    expect(
      within(screen.getByRole('navigation', { name: 'Act contents' }))
        .getByRole('link', { name: /s\. 29/ })
        .getAttribute('href'),
    ).toBe(`${canonicalUrl}#section-29`)
  })

  it('loads text incrementally and keeps schedules after the body', async () => {
    renderView()
    await screen.findByText('Wording of s. 1')
    expect(screen.queryByText('Wording of s. 55')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Load more Act text' }))
    await screen.findByText('Wording of Sch. 1 para. 1')
    const text = within(screen.getByRole('region', { name: 'Act text' }))
    expect(
      text
        .getAllByRole('heading')
        .slice(-3)
        .map((heading) => heading.id),
    ).toEqual(['section-60', 'schedule-1', 'schedule-1-paragraph-1'])
  })

  it('loads and focuses a deep-linked heading without reading preceding pages', async () => {
    renderView('section-55')
    const heading = await screen.findByRole('heading', {
      name: 's. 55 · Section heading 55',
    })
    expect(document.activeElement).toBe(heading)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Wording of s. 1')).toBeNull()
    expect(
      vi
        .mocked(fetch)
        .mock.calls.map(([url]) => url)
        .filter((url) => String(url).includes('/text?')),
    ).toEqual([`/api/search/legislation/${identity}/text?offset=50&limit=50`])
    fireEvent.click(screen.getByRole('button', { name: 'Contents' }))
    const active = within(
      screen.getByRole('navigation', { name: 'Act contents' }),
    ).getByRole('link', { name: /s\. 55/ })
    expect(active.getAttribute('aria-current')).toBe('location')
  })

  it('reports a failed text request while keeping Act provenance and contents', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      url.includes('/text?')
        ? Response.json({}, { status: 503 })
        : Response.json({ act }),
    )
    renderView()
    expect(
      await screen.findByText(
        'This part of the Act could not be loaded.',
        undefined,
        { timeout: 3000 },
      ),
    ).toBeTruthy()
    expect(screen.getByRole('heading', { name: act.title })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('encodes each identity segment in the request URL', async () => {
    const options = legislationActQueryOptions('ukpga/2025/1 A')
    if (typeof options.queryFn !== 'function')
      throw new Error('Expected a query function')
    const client = new QueryClient()
    await client.fetchQuery(options)
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain(
      '/api/search/legislation/ukpga/2025/1%20A',
    )
  })
})
