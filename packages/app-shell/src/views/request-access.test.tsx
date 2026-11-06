import '@obiter/test-dom'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))

const apiModule = { ...(await import('../api')) }
mock.module('../api', () => ({ ...apiModule, apiFetch: api.apiFetch }))

const { ApiError } = await import('../api')
const { RequestAccessRouteView } = await import('./request-access')

function renderRequestAccess(botCheckSiteKey?: string) {
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <RequestAccessRouteView botCheckSiteKey={botCheckSiteKey} />
    ),
  })
  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sign-in',
    component: () => <p>Sign in page</p>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, signInRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

async function fillRequest(
  overrides: { email?: string; attestations?: boolean } = {},
) {
  fireEvent.change(await screen.findByRole('textbox', { name: 'Name' }), {
    target: { value: 'Alex Morgan' },
  })
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Work or university email' }),
    {
      target: {
        value: overrides.email ?? 'alex.morgan@harringtonvale.example',
      },
    },
  )
  fireEvent.click(screen.getByRole('radio', { name: /Legal professional/ }))
  fireEvent.click(screen.getByRole('combobox', { name: 'Country' }))
  fireEvent.click(
    await screen.findByRole('option', { name: 'England and Wales' }),
  )
  fireEvent.change(screen.getByRole('textbox', { name: 'Organisation name' }), {
    target: { value: 'Harrington Vale LLP' },
  })
  if (overrides.attestations === false) return
  fireEvent.click(
    screen.getByRole('checkbox', { name: /I accept the terms of service/i }),
  )
  fireEvent.click(
    screen.getByRole('checkbox', { name: /I have read the privacy policy/i }),
  )
  fireEvent.click(
    screen.getByRole('checkbox', { name: /details I have given are true/i }),
  )
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Request access' }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  delete window.turnstile
})

type FakeTurnstileOptions = {
  sitekey: string
  action?: string
  callback?: (token: string) => void
  'error-callback'?: () => void
}

function installFakeTurnstile() {
  const widget: { options?: FakeTurnstileOptions } = {}
  const fake = {
    render: vi.fn((_element: HTMLElement, options: FakeTurnstileOptions) => {
      widget.options = options
      return 'widget-1'
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  }
  window.turnstile = fake
  return { fake, widget }
}

describe('access request form', () => {
  it('asks for the required details before anything is sent', async () => {
    renderRequestAccess()
    await screen.findByRole('heading', { name: 'Request access' })
    submit()

    await waitFor(() => {
      expect(screen.getByText('Name is required.')).toBeTruthy()
    })
    expect(screen.getByText('Email is required.')).toBeTruthy()
    expect(screen.getByText('Choose the category that fits you.')).toBeTruthy()
    expect(screen.getByText('Choose where you are based.')).toBeTruthy()
    expect(screen.getByText('Organisation name is required.')).toBeTruthy()
    expect(
      screen.getByText(
        /Accept the terms of service, confirm you have read the privacy policy/i,
      ),
    ).toBeTruthy()
    expect(api.apiFetch).not.toHaveBeenCalled()
  })

  it('refuses a free webmail address before sending', async () => {
    renderRequestAccess()
    await fillRequest({ email: 'alex.morgan@gmail.com' })
    submit()

    expect(
      await screen.findByText(
        'Please use your work or university email address.',
      ),
    ).toBeTruthy()
    expect(api.apiFetch).not.toHaveBeenCalled()
  })

  it('refuses an obvious non-UK academic address before sending', async () => {
    renderRequestAccess()
    await fillRequest({ email: 'alex@law.harvard.edu' })
    submit()

    expect(
      await screen.findByText(
        'Obiter is available to legal professionals, researchers and students in the UK.',
      ),
    ).toBeTruthy()
    expect(api.apiFetch).not.toHaveBeenCalled()
  })

  it('will not send until the terms, the privacy policy and the details are confirmed', async () => {
    renderRequestAccess()
    await fillRequest({ attestations: false })
    submit()

    expect(
      await screen.findByText(
        /Accept the terms of service, confirm you have read the privacy policy and confirm your details/i,
      ),
    ).toBeTruthy()
    expect(api.apiFetch).not.toHaveBeenCalled()
  })

  it('sends the access request in the shape the API validates', async () => {
    api.apiFetch.mockResolvedValueOnce({ status: 'confirmation_sent' })
    renderRequestAccess()
    await fillRequest()
    submit()

    await waitFor(() => {
      expect(api.apiFetch).toHaveBeenCalledWith('/api/access-requests', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Alex Morgan',
          email: 'alex.morgan@harringtonvale.example',
          category: 'legal_professional',
          country: 'england_and_wales',
          organisationName: 'Harrington Vale LLP',
          setUpOrganisation: false,
          acceptedTerms: true,
          acceptedPrivacyNotice: true,
          detailsAreTrue: true,
        }),
      })
    })
  })

  it('sends a request that sets up the organisation when the applicant asks to', async () => {
    api.apiFetch.mockResolvedValueOnce({ status: 'confirmation_sent' })
    renderRequestAccess()
    await fillRequest()
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /I am setting up this organisation/i,
      }),
    )
    submit()

    await waitFor(() => {
      expect(api.apiFetch).toHaveBeenCalledTimes(1)
    })
    const body = api.apiFetch.mock.calls[0]?.[1]?.body
    expect(JSON.parse(String(body))).toMatchObject({ setUpOrganisation: true })
  })

  it('shows the check your inbox state naming the address it was sent to', async () => {
    api.apiFetch.mockResolvedValueOnce({ status: 'confirmation_sent' })
    renderRequestAccess()
    await fillRequest()
    submit()

    expect(await screen.findByText('Check your inbox')).toBeTruthy()
    expect(screen.getByText('alex.morgan@harringtonvale.example')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Request access' })).toBeNull()
  })

  it('shows the API webmail refusal against the email field and keeps the form', async () => {
    api.apiFetch.mockRejectedValueOnce(
      new ApiError('webmail_address', 'Use a work address.', 400, 'req_1'),
    )
    renderRequestAccess()
    await fillRequest()
    submit()

    expect(
      await screen.findByText(
        'Please use your work or university email address.',
      ),
    ).toBeTruthy()
    expect(
      (screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value,
    ).toBe('Alex Morgan')
  })

  it('reports a rate-limited request without losing what was typed', async () => {
    api.apiFetch.mockRejectedValueOnce(
      new ApiError('rate_limited', 'Too many requests.', 429, 'req_2'),
    )
    renderRequestAccess()
    await fillRequest()
    submit()

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(
      screen.getByText(/Too many requests from this address/i),
    ).toBeTruthy()
    expect(
      (screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value,
    ).toBe('Alex Morgan')
  })

  it('shows the API message when the request fails with a code it does not map', async () => {
    api.apiFetch.mockRejectedValueOnce(
      new ApiError('conflict_detected', 'A request is already open.', 409, 'r'),
    )
    renderRequestAccess()
    await fillRequest()
    submit()

    expect(await screen.findByText('A request is already open.')).toBeTruthy()
  })

  it('shows the reason the API gives for refusing the request', async () => {
    api.apiFetch.mockRejectedValueOnce(
      new ApiError('invalid_request', 'Complete the bot check.', 400, 'r'),
    )
    renderRequestAccess()
    await fillRequest()
    submit()

    expect(await screen.findByText('Complete the bot check.')).toBeTruthy()
  })

  describe('with the bot check', () => {
    it('waits for the check, then sends its token', async () => {
      const { fake, widget } = installFakeTurnstile()
      api.apiFetch.mockResolvedValueOnce({ status: 'confirmation_sent' })
      renderRequestAccess('site-key')
      await fillRequest()

      await waitFor(() => expect(fake.render).toHaveBeenCalledTimes(1))
      expect(widget.options).toMatchObject({
        sitekey: 'site-key',
        action: 'request-access',
      })
      const waiting = screen.getByRole('button', {
        name: 'Checking your browser…',
      })
      expect(waiting.hasAttribute('disabled')).toBe(true)

      act(() => widget.options?.callback?.('token-123'))
      submit()

      await waitFor(() => expect(api.apiFetch).toHaveBeenCalledTimes(1))
      const body = JSON.parse(String(api.apiFetch.mock.calls[0]?.[1]?.body))
      expect(body.botCheckToken).toBe('token-123')
    })

    it('still lets the request through for the server to judge when the check cannot run', async () => {
      const { fake, widget } = installFakeTurnstile()
      api.apiFetch.mockResolvedValueOnce({ status: 'confirmation_sent' })
      renderRequestAccess('site-key')
      await fillRequest()
      await waitFor(() => expect(fake.render).toHaveBeenCalledTimes(1))

      act(() => widget.options?.['error-callback']?.())
      submit()

      await waitFor(() => expect(api.apiFetch).toHaveBeenCalledTimes(1))
      const body = JSON.parse(String(api.apiFetch.mock.calls[0]?.[1]?.body))
      expect(body).not.toHaveProperty('botCheckToken')
    })

    it('asks for a fresh check after a refused request', async () => {
      const { fake, widget } = installFakeTurnstile()
      api.apiFetch.mockRejectedValueOnce(new Error('network down'))
      renderRequestAccess('site-key')
      await fillRequest()
      await waitFor(() => expect(fake.render).toHaveBeenCalledTimes(1))

      act(() => widget.options?.callback?.('token-123'))
      submit()

      await waitFor(() => expect(fake.reset).toHaveBeenCalledWith('widget-1'))
      expect(
        screen.getByRole('button', { name: 'Checking your browser…' }),
      ).toBeTruthy()
    })
  })
})
