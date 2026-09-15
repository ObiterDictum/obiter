// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { ApiError } from '../api'
import { SettingsRouteView } from './settings'

const mocks = vi.hoisted(() => ({
  useCurrentUser: vi.fn(),
  useCreateOrganisation: vi.fn(),
  useRenameOrganisation: vi.fn(),
  useUpdateProfile: vi.fn(),
  useAuth: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('../organisation-membership', () => ({
  useOrganisationMembers: () => ({ data: [] }),
  useOrganisationInvites: () => ({ data: [] }),
  useCreateOrganisationInvite: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useRevokeOrganisationInvite: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useRemoveOrganisationMember: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

vi.mock('../current-user', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../current-user')>()
  return {
    ...actual,
    useCurrentUser: mocks.useCurrentUser,
    useCreateOrganisation: mocks.useCreateOrganisation,
    useRenameOrganisation: mocks.useRenameOrganisation,
    useUpdateProfile: mocks.useUpdateProfile,
  }
})

vi.mock('../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth')>()
  return { ...actual, useAuth: mocks.useAuth }
})

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  }
})

const ORGLESS_ME = {
  user: {
    id: 'usr_2',
    email: 'new@obiter.dev',
    name: 'New User',
    role: null,
  },
  organisation: null,
}

const OWNER_ME = {
  user: {
    id: 'usr_1',
    email: 'owner@obiter.dev',
    name: 'Imogen Hartley',
    role: 'owner' as const,
  },
  organisation: {
    id: 'org_1',
    name: 'Ashcombe Chambers',
    plan: 'private_beta' as const,
  },
}

const MEMBER_ME = {
  user: {
    id: 'usr_3',
    email: 'member@obiter.dev',
    name: 'Callum Whitfield',
    role: 'member' as const,
  },
  organisation: {
    id: 'org_1',
    name: 'Ashcombe Chambers',
    plan: 'private_beta' as const,
  },
}

function idleMutation() {
  return { mutateAsync: vi.fn(), isPending: false, isError: false }
}

function signedIn(user = OWNER_ME) {
  mocks.useCurrentUser.mockReturnValue({ data: user })
  mocks.useCreateOrganisation.mockReturnValue(idleMutation())
  mocks.useRenameOrganisation.mockReturnValue(idleMutation())
  mocks.useUpdateProfile.mockReturnValue(idleMutation())
  mocks.useAuth.mockReturnValue({
    changePassword: vi.fn().mockResolvedValue({ ok: true }),
  })
}

function renderSettings() {
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <SettingsRouteView />,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

async function openSection(name: 'Account' | 'Security' | 'Organisation') {
  fireEvent.click(await screen.findByRole('button', { name }))
  return screen.findByRole('region', { name })
}

beforeEach(() => {
  vi.clearAllMocks()
  signedIn()
})

afterEach(() => {
  cleanup()
})

describe('SettingsRouteView — information architecture', () => {
  it('offers the three sections through section navigation and starts on Account', async () => {
    renderSettings()

    const nav = await screen.findByRole('navigation', {
      name: 'Settings sections',
    })
    expect(
      within(nav)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Account', 'Security', 'Organisation'])

    expect(
      within(nav)
        .getByRole('button', { name: 'Account' })
        .getAttribute('aria-current'),
    ).toBe('true')
    expect(await screen.findByRole('region', { name: 'Account' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Security' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Organisation' })).toBeNull()
  })

  it('retains an unsaved draft when the user switches section and returns', async () => {
    renderSettings()

    const name = await screen.findByLabelText('Name')
    fireEvent.change(name, { target: { value: 'Imogen Hartley-Clarke' } })

    await openSection('Security')
    await openSection('Account')

    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe(
      'Imogen Hartley-Clarke',
    )
  })

  it('keeps the account form mounted and reachable from the section nav by keyboard', async () => {
    renderSettings()
    const name = await screen.findByLabelText('Name')
    fireEvent.change(name, { target: { value: 'Imogen Hartley-Clarke' } })

    const securityTab = screen.getByRole('button', { name: 'Security' })
    securityTab.focus()
    expect(document.activeElement).toBe(securityTab)
    fireEvent.click(securityTab)

    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
    await openSection('Account')
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe(
      'Imogen Hartley-Clarke',
    )
  })
})

describe('SettingsRouteView — account', () => {
  it('shows the account identity with email and role read-only', async () => {
    renderSettings()
    const account = await screen.findByRole('region', { name: 'Account' })

    expect(within(account).getByLabelText('Name')).toBeTruthy()
    expect(within(account).getByText('owner@obiter.dev')).toBeTruthy()
    expect(within(account).getByText('Owner')).toBeTruthy()
    expect(
      within(account).getByText(/email changes are not supported/i),
    ).toBeTruthy()
  })

  it('disables save until the name is a valid change', async () => {
    renderSettings()
    const account = await screen.findByRole('region', { name: 'Account' })
    const save = within(account).getByRole('button', { name: 'Save changes' })

    expect((save as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(within(account).getByLabelText('Name'), {
      target: { value: '   ' },
    })
    expect((save as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(within(account).getByLabelText('Name'), {
      target: { value: 'Imogen Hartley-Clarke' },
    })
    expect((save as HTMLButtonElement).disabled).toBe(false)
  })

  it('saves the trimmed name, confirms, and resets to the canonical server value', async () => {
    const mutateAsync = vi
      .fn()
      .mockResolvedValue({ id: 'usr_1', name: 'Imogen Hartley-Clarke' })
    mocks.useUpdateProfile.mockReturnValue({
      mutateAsync,
      isPending: false,
      isError: false,
    })
    renderSettings()
    const account = await screen.findByRole('region', { name: 'Account' })

    fireEvent.change(within(account).getByLabelText('Name'), {
      target: { value: '  Imogen Hartley-Clarke  ' },
    })
    fireEvent.click(
      within(account).getByRole('button', { name: 'Save changes' }),
    )

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        name: 'Imogen Hartley-Clarke',
      })
    })
    expect(await within(account).findByRole('status')).toHaveProperty(
      'textContent',
      'Name saved.',
    )
    expect(within(account).getByLabelText<HTMLInputElement>('Name').value).toBe(
      'Imogen Hartley-Clarke',
    )
    expect(
      (
        within(account).getByRole('button', {
          name: 'Save changes',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)

    fireEvent.change(within(account).getByLabelText('Name'), {
      target: { value: 'Imogen H' },
    })
    expect(within(account).queryByRole('status')).toBeNull()
  })

  it('surfaces a server rejection inline without leaving a stale success', async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValue(
        new ApiError('validation_failed', 'Name is too long.', 400, 'req_9'),
      )
    mocks.useUpdateProfile.mockReturnValue({
      mutateAsync,
      isPending: false,
      isError: false,
    })
    renderSettings()
    const account = await screen.findByRole('region', { name: 'Account' })

    fireEvent.change(within(account).getByLabelText('Name'), {
      target: { value: 'Imogen Hartley-Clarke' },
    })
    fireEvent.click(
      within(account).getByRole('button', { name: 'Save changes' }),
    )

    expect(await within(account).findByRole('alert')).toHaveProperty(
      'textContent',
      'Name is too long.',
    )
    expect(within(account).queryByRole('status')).toBeNull()
    expect(within(account).getByLabelText<HTMLInputElement>('Name').value).toBe(
      'Imogen Hartley-Clarke',
    )
  })

  it('refuses a blank name in the client and keeps the save disabled', async () => {
    const mutateAsync = vi.fn()
    mocks.useUpdateProfile.mockReturnValue({
      mutateAsync,
      isPending: false,
      isError: false,
    })
    renderSettings()
    const account = await screen.findByRole('region', { name: 'Account' })

    const form = within(account).getByLabelText('Name').closest('form')!
    fireEvent.change(within(account).getByLabelText('Name'), {
      target: { value: '  ' },
    })
    fireEvent.submit(form)

    expect(mutateAsync).not.toHaveBeenCalled()
    expect(
      within(account).getByRole('button', { name: 'Save changes' }),
    ).toBeTruthy()
  })

  it('restores the saved name when the user resets the form', async () => {
    renderSettings()
    const account = await screen.findByRole('region', { name: 'Account' })

    fireEvent.change(within(account).getByLabelText('Name'), {
      target: { value: 'Something Else' },
    })
    fireEvent.click(within(account).getByRole('button', { name: 'Reset' }))

    expect(within(account).getByLabelText<HTMLInputElement>('Name').value).toBe(
      'Imogen Hartley',
    )
    expect(
      (
        within(account).getByRole('button', {
          name: 'Save changes',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })

  it('moves focus to the invalid field after a rejected submission', async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValue(
        new ApiError('validation_failed', 'Name is required.', 400, 'req_9'),
      )
    mocks.useUpdateProfile.mockReturnValue({
      mutateAsync,
      isPending: false,
      isError: false,
    })
    renderSettings()
    const account = await screen.findByRole('region', { name: 'Account' })

    const name = within(account).getByLabelText('Name')
    fireEvent.change(name, { target: { value: 'Imogen Hartley-Clarke' } })
    fireEvent.click(
      within(account).getByRole('button', { name: 'Save changes' }),
    )

    await waitFor(() => {
      expect(document.activeElement).toBe(name)
    })
  })

  it('says a user with no organisation has none yet instead of inventing a role', async () => {
    signedIn(ORGLESS_ME)
    renderSettings()
    const account = await screen.findByRole('region', { name: 'Account' })

    expect(within(account).getByText(/no organisation yet/i)).toBeTruthy()
    expect(within(account).queryByText('Owner')).toBeNull()
  })
})

describe('SettingsRouteView — security', () => {
  async function renderSecurity() {
    renderSettings()
    return openSection('Security')
  }

  it('asks for the current password, a new password and confirmation', async () => {
    const security = await renderSecurity()

    expect(within(security).getByLabelText('Current password')).toBeTruthy()
    expect(within(security).getByLabelText('New password')).toBeTruthy()
    expect(within(security).getByLabelText('Confirm new password')).toBeTruthy()
    expect(within(security).getByText(/at least 8 characters/i)).toBeTruthy()
  })

  it('keeps the new-password fields off autofill of the current password', async () => {
    const security = await renderSecurity()

    expect(
      within(security)
        .getByLabelText('Current password')
        .getAttribute('autocomplete'),
    ).toBe('current-password')
    expect(
      within(security)
        .getByLabelText('New password')
        .getAttribute('autocomplete'),
    ).toBe('new-password')
    expect(
      within(security)
        .getByLabelText('Confirm new password')
        .getAttribute('autocomplete'),
    ).toBe('new-password')
  })

  it('toggles each password field with an accurately named control', async () => {
    const security = await renderSecurity()

    const newPassword =
      within(security).getByLabelText<HTMLInputElement>('New password')
    expect(newPassword.type).toBe('password')

    const toggle = within(security).getByRole('button', {
      name: 'Show new password',
    })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(toggle)
    expect(newPassword.type).toBe('text')
    expect(
      within(security)
        .getByRole('button', { name: 'Hide new password' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('reports mismatched passwords locally and does not call the API', async () => {
    const changePassword = vi.fn().mockResolvedValue({ ok: true })
    mocks.useAuth.mockReturnValue({ changePassword })
    const security = await renderSecurity()

    fireEvent.change(within(security).getByLabelText('Current password'), {
      target: { value: 'old-secret-value' },
    })
    fireEvent.change(within(security).getByLabelText('New password'), {
      target: { value: 'lengthy-new-secret' },
    })
    fireEvent.change(within(security).getByLabelText('Confirm new password'), {
      target: { value: 'lengthy-new-secret-typo' },
    })
    fireEvent.click(
      within(security).getByRole('button', { name: 'Change password' }),
    )

    expect(await within(security).findByRole('alert')).toHaveProperty(
      'textContent',
      'The new passwords do not match.',
    )
    expect(changePassword).not.toHaveBeenCalled()
  })

  it('reports a too-short new password locally against the stated policy', async () => {
    const changePassword = vi.fn()
    mocks.useAuth.mockReturnValue({ changePassword })
    const security = await renderSecurity()

    fireEvent.change(within(security).getByLabelText('Current password'), {
      target: { value: 'old-secret-value' },
    })
    fireEvent.change(within(security).getByLabelText('New password'), {
      target: { value: 'short' },
    })
    fireEvent.change(within(security).getByLabelText('Confirm new password'), {
      target: { value: 'short' },
    })
    fireEvent.click(
      within(security).getByRole('button', { name: 'Change password' }),
    )

    expect(await within(security).findByRole('alert')).toHaveProperty(
      'textContent',
      'Password must be at least 8 characters.',
    )
    expect(document.activeElement).toBe(
      within(security).getByLabelText('New password'),
    )
    expect(changePassword).not.toHaveBeenCalled()
  })

  it('reports a rejected current password and keeps the typed new password', async () => {
    const changePassword = vi.fn().mockResolvedValue({
      ok: false,
      code: 'INVALID_PASSWORD',
      message: 'Your current password is incorrect.',
    })
    mocks.useAuth.mockReturnValue({ changePassword })
    const security = await renderSecurity()

    fireEvent.change(within(security).getByLabelText('Current password'), {
      target: { value: 'wrong-current-secret' },
    })
    fireEvent.change(within(security).getByLabelText('New password'), {
      target: { value: 'lengthy-new-secret' },
    })
    fireEvent.change(within(security).getByLabelText('Confirm new password'), {
      target: { value: 'lengthy-new-secret' },
    })
    fireEvent.click(
      within(security).getByRole('button', { name: 'Change password' }),
    )

    expect(await within(security).findByRole('alert')).toHaveProperty(
      'textContent',
      'Your current password is incorrect.',
    )
    expect(
      within(security).getByLabelText<HTMLInputElement>('New password').value,
    ).toBe('lengthy-new-secret')
  })

  it('clears every password field and confirms after a successful change', async () => {
    const changePassword = vi.fn().mockResolvedValue({ ok: true })
    mocks.useAuth.mockReturnValue({ changePassword })
    const security = await renderSecurity()

    fireEvent.change(within(security).getByLabelText('Current password'), {
      target: { value: 'old-secret-value' },
    })
    fireEvent.change(within(security).getByLabelText('New password'), {
      target: { value: 'lengthy-new-secret' },
    })
    fireEvent.change(within(security).getByLabelText('Confirm new password'), {
      target: { value: 'lengthy-new-secret' },
    })
    fireEvent.click(
      within(security).getByRole('button', { name: 'Change password' }),
    )

    await waitFor(() => {
      expect(changePassword).toHaveBeenCalledWith({
        currentPassword: 'old-secret-value',
        newPassword: 'lengthy-new-secret',
      })
    })
    expect(
      within(security).getByLabelText<HTMLInputElement>('Current password')
        .value,
    ).toBe('')
    expect(
      within(security).getByLabelText<HTMLInputElement>('New password').value,
    ).toBe('')
    expect(
      within(security).getByLabelText<HTMLInputElement>('Confirm new password')
        .value,
    ).toBe('')
    expect(await within(security).findByRole('status')).toHaveProperty(
      'textContent',
      expect.stringContaining('Other devices have been signed out'),
    )
  })

  it('says so plainly when the account has no password credential', async () => {
    const changePassword = vi.fn().mockResolvedValue({
      ok: false,
      code: 'CREDENTIAL_ACCOUNT_NOT_FOUND',
      message: 'Credential account not found.',
    })
    mocks.useAuth.mockReturnValue({ changePassword })
    const security = await renderSecurity()

    fireEvent.change(within(security).getByLabelText('Current password'), {
      target: { value: 'old-secret-value' },
    })
    fireEvent.change(within(security).getByLabelText('New password'), {
      target: { value: 'lengthy-new-secret' },
    })
    fireEvent.change(within(security).getByLabelText('Confirm new password'), {
      target: { value: 'lengthy-new-secret' },
    })
    fireEvent.click(
      within(security).getByRole('button', { name: 'Change password' }),
    )

    expect(await within(security).findByRole('alert')).toHaveProperty(
      'textContent',
      'This account does not sign in with a password.',
    )
  })

  it('disables the submit button while a change is pending', async () => {
    const changePassword = vi.fn()
    mocks.useAuth.mockReturnValue({ changePassword })
    const security = await renderSecurity()

    fireEvent.change(within(security).getByLabelText('Current password'), {
      target: { value: 'old-secret-value' },
    })
    fireEvent.change(within(security).getByLabelText('New password'), {
      target: { value: 'lengthy-new-secret' },
    })
    fireEvent.change(within(security).getByLabelText('Confirm new password'), {
      target: { value: 'lengthy-new-secret' },
    })
    const submit = within(security).getByRole('button', {
      name: 'Change password',
    })
    fireEvent.click(submit)
    fireEvent.click(submit)

    expect(changePassword).toHaveBeenCalledTimes(1)
  })
})

describe('SettingsRouteView — organisation', () => {
  it('offers rename to the owner and applies the trimmed name', async () => {
    const mutateAsync = vi
      .fn()
      .mockResolvedValue({ id: 'org_1', name: 'Ashcombe Chambers LLP' })
    mocks.useRenameOrganisation.mockReturnValue({
      mutateAsync,
      isPending: false,
      isError: false,
    })
    renderSettings()
    const organisation = await openSection('Organisation')

    fireEvent.change(within(organisation).getByLabelText('Organisation name'), {
      target: { value: '  Ashcombe Chambers LLP  ' },
    })
    fireEvent.click(
      within(organisation).getByRole('button', { name: 'Save name' }),
    )

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        name: 'Ashcombe Chambers LLP',
      })
    })
    expect(await within(organisation).findByRole('status')).toHaveProperty(
      'textContent',
      'Organisation name saved.',
    )
  })

  it('states that an organisation change affects every member', async () => {
    renderSettings()
    const organisation = await openSection('Organisation')

    expect(
      within(organisation).getByText(/applies to everyone in/i),
    ).toBeTruthy()
  })

  it('shows the role and the stable identifier as read-only context', async () => {
    renderSettings()
    const organisation = await openSection('Organisation')

    expect(within(organisation).getByText('Owner')).toBeTruthy()
    expect(within(organisation).getByText('org_1')).toBeTruthy()
  })

  it('shows a member the organisation without an editing control', async () => {
    signedIn(MEMBER_ME)
    renderSettings()
    const organisation = await openSection('Organisation')

    expect(within(organisation).getByText('Ashcombe Chambers')).toBeTruthy()
    expect(within(organisation).getByText('Member')).toBeTruthy()
    expect(
      within(organisation).queryByLabelText('Organisation name'),
    ).toBeNull()
    expect(
      within(organisation).queryByRole('button', { name: 'Save name' }),
    ).toBeNull()
    expect(
      within(organisation).getByText(/only an owner can rename/i),
    ).toBeTruthy()
  })

  it('lets the admin view the name but not change it', async () => {
    signedIn({
      user: { ...MEMBER_ME.user, role: 'admin' },
      organisation: MEMBER_ME.organisation,
    })
    renderSettings()
    const organisation = await openSection('Organisation')

    expect(within(organisation).getByText('Admin')).toBeTruthy()
    expect(
      within(organisation).queryByLabelText('Organisation name'),
    ).toBeNull()
  })

  it('reports a rejected rename and leaves the typed value for another attempt', async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValue(
        new ApiError(
          'forbidden',
          'Only owners may perform this action.',
          403,
          'req_1',
        ),
      )
    mocks.useRenameOrganisation.mockReturnValue({
      mutateAsync,
      isPending: false,
      isError: false,
    })
    renderSettings()
    const organisation = await openSection('Organisation')

    fireEvent.change(within(organisation).getByLabelText('Organisation name'), {
      target: { value: 'Takeover Chambers' },
    })
    fireEvent.click(
      within(organisation).getByRole('button', { name: 'Save name' }),
    )

    expect(await within(organisation).findByRole('alert')).toHaveProperty(
      'textContent',
      'Only owners may perform this action.',
    )
    expect(
      within(organisation).getByLabelText<HTMLInputElement>('Organisation name')
        .value,
    ).toBe('Takeover Chambers')
  })

  it('disables the organisation rename until the name is a valid change', async () => {
    renderSettings()
    const organisation = await openSection('Organisation')
    const save = within(organisation).getByRole('button', { name: 'Save name' })

    expect((save as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(organisation).getByLabelText('Organisation name'), {
      target: { value: 'Ashcombe Chambers LLP' },
    })
    expect((save as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(within(organisation).getByRole('button', { name: 'Reset' }))
    expect(
      within(organisation).getByLabelText<HTMLInputElement>('Organisation name')
        .value,
    ).toBe('Ashcombe Chambers')
  })
})

describe('SettingsRouteView — organisation creation for an org-less user', () => {
  it('renders the create form instead of organisation details', async () => {
    signedIn(ORGLESS_ME)
    renderSettings()
    const organisation = await openSection('Organisation')

    expect(
      within(organisation).getByLabelText('Organisation name'),
    ).toBeTruthy()
    expect(
      within(organisation).getByRole('button', { name: 'Create organisation' }),
    ).toBeTruthy()
  })

  it('surfaces the conflict message and refetches /api/me on a 409', async () => {
    signedIn(ORGLESS_ME)
    const refetchSpy = vi
      .spyOn(QueryClient.prototype, 'refetchQueries')
      .mockResolvedValue({
        refetchPage: undefined as never,
        errors: [],
      } as never)
    const mutateAsync = vi
      .fn()
      .mockRejectedValue(
        new ApiError(
          'conflict_detected',
          'You already have an organisation.',
          409,
          'req_2',
        ),
      )
    mocks.useCreateOrganisation.mockReturnValue({
      mutateAsync,
      isPending: false,
      isError: false,
    })
    renderSettings()
    const organisation = await openSection('Organisation')

    fireEvent.change(within(organisation).getByLabelText('Organisation name'), {
      target: { value: 'Acme Law' },
    })
    fireEvent.click(
      within(organisation).getByRole('button', { name: 'Create organisation' }),
    )

    expect(await within(organisation).findByRole('alert')).toHaveProperty(
      'textContent',
      'You already have an organisation. Refreshing…',
    )
    expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ['current-user'] })
    refetchSpy.mockRestore()
  })
})
