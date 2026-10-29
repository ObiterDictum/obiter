import '@obiter/test-dom'
import { Suspense, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { ToastProvider } from '@obiter/ui'

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
      Link: ({
        children,
        to,
        ...props
      }: {
        children: ReactNode
        to: string
        [key: string]: unknown
      }) => (
        <a href={to} {...props}>
          {children}
        </a>
      ),
      useNavigate: () => () => undefined,
    }))(),
  ),
)

const { LegislationProvisionView } = await import('./LegislationProvisionView')

const CURRENT_PAYLOAD = {
  provision: {
    id: 'ukpga/2010/15/section/13',
    documentIdentity: 'ukpga/2010/15',
    title: 'Equality Act 2010',
    year: 2010,
    provisionLabel: 's. 13',
    labelPath: 'section/13',
    extent: 'E+W+S',
    legislationStatus: 'current' as const,
    text: 'Direct discrimination applies here.',
    officialUrl: 'https://www.legislation.gov.uk/ukpga/2010/15/section/13',
    sourceUrl: 'https://www.legislation.gov.uk/ukpga/2010/15',
    canonicalUrl: '/ln/ukpga/2010/15/section/13',
  },
}

const WITHHELD_PAYLOAD = {
  provision: {
    ...CURRENT_PAYLOAD.provision,
    id: 'ukpga/2010/15/section/80',
    provisionLabel: 's. 80',
    labelPath: 'section/80',
    legislationStatus: 'amended_not_held' as const,
    text: undefined,
    officialUrl: 'https://www.legislation.gov.uk/ukpga/2010/15/section/80',
    notice:
      'This provision is affected by amendments that have been recorded but not yet applied.',
    canonicalUrl: '/ln/ukpga/2010/15/section/80',
  },
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

function renderView(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <ToastProvider>
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={<div>Loading</div>}>
          <LegislationProvisionView provisionPath={path} />
        </Suspense>
      </QueryClientProvider>
    </ToastProvider>,
  )
}

describe('LegislationProvisionView', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/section/13')) return jsonResponse(CURRENT_PAYLOAD)
        if (url.includes('/section/80')) return jsonResponse(WITHHELD_PAYLOAD)
        return jsonResponse({}, false, 404)
      }),
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows the full provision text, parent Act, extent, and official link', async () => {
    renderView('ukpga/2010/15/section/13')
    expect(
      await screen.findByText('Direct discrimination applies here.'),
    ).toBeTruthy()
    expect(screen.getAllByText('Equality Act 2010').length).toBeGreaterThan(0)
    expect(screen.getAllByText('E+W+S').length).toBeGreaterThan(0)
    expect(
      screen.getAllByText('No unapplied amendments').length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText('Point-in-time date not recorded').length,
    ).toBeGreaterThan(0)
    expect(
      screen
        .getAllByRole('link', { name: 'Open original' })[0]
        ?.getAttribute('href'),
    ).toBe('https://www.legislation.gov.uk/ukpga/2010/15/section/13')
  })

  it('withholds text and states why', async () => {
    renderView('ukpga/2010/15/section/80')
    await waitFor(() => {
      expect(
        screen.getAllByText('Amended wording withheld').length,
      ).toBeGreaterThan(0)
    })
    expect(screen.getByText(/amendments that have been recorded/)).toBeTruthy()
    expect(screen.queryByText('Direct discrimination applies here.')).toBeNull()
  })

  it('renders a section heading and its subsections nested, each citable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          provision: {
            ...CURRENT_PAYLOAD.provision,
            heading: 'Direct discrimination',
            text: '',
            acquiredAt: '2026-09-06T14:49:54.709Z',
            subsections: [
              {
                label: 's. 13(1)',
                labelPath: 'section/13/1',
                href: '/ln/ukpga/2010/15/section/13/1',
                legislationStatus: 'current',
                text: 'A person (A) discriminates against another (B).',
                children: [],
              },
              {
                label: 's. 13(6)',
                labelPath: 'section/13/6',
                href: '/ln/ukpga/2010/15/section/13/6',
                legislationStatus: 'current',
                text: 'If the protected characteristic is sex—',
                children: [
                  {
                    label: 's. 13(6)(a)',
                    labelPath: 'section/13/6/a',
                    href: '/ln/ukpga/2010/15/section/13/6/a',
                    legislationStatus: 'current',
                    text: 'less favourable treatment of a woman includes…',
                    children: [],
                  },
                ],
              },
              {
                label: 's. 13(7)',
                labelPath: 'section/13/7',
                href: '/ln/ukpga/2010/15/section/13/7',
                legislationStatus: 'amended_not_held',
                children: [],
              },
            ],
          },
        }),
      ),
    )

    renderView('ukpga/2010/15/section/13')

    expect(await screen.findByText('Direct discrimination')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 's. 13(1) of this provision' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 's. 13(6)(a) of this provision' }),
    ).toBeTruthy()
    expect(
      screen.getByText('A person (A) discriminates against another (B).'),
    ).toBeTruthy()
    expect(screen.getByText(/Wording withheld/)).toBeTruthy()
    expect(screen.getByText(/Retrieved 6 Sept 2026/)).toBeTruthy()
  })

  it('shows a source failure with a retry instead of empty provision text', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockRejectedValue(new Error('network down'))
    renderView('ukpga/2010/15/section/13')
    expect(
      await screen.findByText('Provision could not be loaded', undefined, {
        timeout: 3000,
      }),
    ).toBeTruthy()
    fetchMock.mockResolvedValueOnce(jsonResponse(CURRENT_PAYLOAD))
    screen.getByRole('button', { name: 'Retry' }).click()
    await waitFor(() => {
      expect(
        screen.getByText('Direct discrimination applies here.'),
      ).toBeTruthy()
    })
  })
})
