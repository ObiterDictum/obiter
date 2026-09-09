// @vitest-environment jsdom
import { Suspense, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { LegislationProvisionView } from './LegislationProvisionView'

vi.mock('@tanstack/react-router', () => ({
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
}))

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
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<div>Loading</div>}>
        <LegislationProvisionView provisionPath={path} />
      </Suspense>
    </QueryClientProvider>,
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
    expect(screen.getByText('Equality Act 2010')).toBeTruthy()
    expect(screen.getByText('2010')).toBeTruthy()
    expect(screen.getByText('E+W+S')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Official text' }).getAttribute('href'),
    ).toBe('https://www.legislation.gov.uk/ukpga/2010/15/section/13')
  })

  it('withholds text and states why', async () => {
    renderView('ukpga/2010/15/section/80')
    await waitFor(() => {
      expect(screen.getByText('Text not shown')).toBeTruthy()
    })
    expect(screen.getByText(/amendments that have been recorded/)).toBeTruthy()
    expect(screen.queryByText('Direct discrimination applies here.')).toBeNull()
  })
})
