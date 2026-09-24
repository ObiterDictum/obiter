import '@obiter/test-dom'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import type { MeResponse } from '@obiter/contracts'
import { ApiError } from '../api'

/**
 * The Account section: the display name the user can change, and the identity
 * facts they cannot. The cache contract behind the save is pinned separately in
 * `settings-cache.test.tsx`, which drives the real mutation.
 */
const mocks = vi.hoisted(() => ({
  useCurrentUser: vi.fn(),
  useCreateOrganisation: vi.fn(),
  useRenameOrganisation: vi.fn(),
  useUpdateProfile: vi.fn(),
  useAuth: vi.fn(),
  navigate: vi.fn(),
}))

// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const organisationMembershipModuleKeys = Object.fromEntries(
  Object.keys(await import('../organisation-membership')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('../organisation-membership', () =>
  Object.assign(
    { ...organisationMembershipModuleKeys },
    (() => ({
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
    }))(),
  ),
)

// The real module, snapshotted before mock.module registers: a factory
// that awaited its own specifier re-entered the in-flight mock and
// deadlocked under bun's module registry.
const currentUserModule = { ...(await import('../current-user')) }
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const currentUserModuleKeys = Object.fromEntries(
  Object.keys(await import('../current-user')).map((key) => [key, undefined]),
)
mock.module('../current-user', () =>
  Object.assign(
    { ...currentUserModuleKeys },
    (() => {
      const actual = currentUserModule
      return {
        ...actual,
        useCurrentUser: mocks.useCurrentUser,
        useCreateOrganisation: mocks.useCreateOrganisation,
        useRenameOrganisation: mocks.useRenameOrganisation,
        useUpdateProfile: mocks.useUpdateProfile,
      }
    })(),
  ),
)

// The real module, snapshotted before mock.module registers: a factory
// that awaited its own specifier re-entered the in-flight mock and
// deadlocked under bun's module registry.
const authModule = { ...(await import('../auth')) }
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const authModuleKeys = Object.fromEntries(
  Object.keys(await import('../auth')).map((key) => [key, undefined]),
)
mock.module('../auth', () =>
  Object.assign(
    { ...authModuleKeys },
    (() => {
      const actual = authModule
      return { ...actual, useAuth: mocks.useAuth }
    })(),
  ),
)

// The real module, snapshotted before mock.module registers: a factory
// that awaited its own specifier re-entered the in-flight mock and
// deadlocked under bun's module registry.
const tanstackReactRouterModule = {
  ...(await import('@tanstack/react-router')),
}
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const tanstackReactRouterModuleKeys = Object.fromEntries(
  Object.keys(await import('@tanstack/react-router')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('@tanstack/react-router', () =>
  Object.assign(
    { ...tanstackReactRouterModuleKeys },
    (() => {
      const actual = tanstackReactRouterModule
      return {
        ...actual,
        useNavigate: () => mocks.navigate,
      }
    })(),
  ),
)

// Loaded after the registrations above: bun does not hoist mock.module the
// way vi.mock was hoisted, and these modules capture mocked imports at
// module scope, so they must evaluate once the mocks are in place.
const { ORGLESS_ME, OWNER_ME, idleMutation, renderSettings } =
  await import('./settings-test-support')

function signedIn(user: MeResponse = OWNER_ME) {
  mocks.useCurrentUser.mockReturnValue({ data: user })
  mocks.useCreateOrganisation.mockReturnValue(idleMutation())
  mocks.useRenameOrganisation.mockReturnValue(idleMutation())
  mocks.useUpdateProfile.mockReturnValue(idleMutation())
  mocks.useAuth.mockReturnValue({
    changePassword: vi.fn().mockResolvedValue({ ok: true }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  signedIn()
})

afterEach(() => {
  cleanup()
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
