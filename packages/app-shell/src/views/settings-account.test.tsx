// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import type { MeResponse } from '@obiter/contracts'
import { ApiError } from '../api'
import {
  ORGLESS_ME,
  OWNER_ME,
  idleMutation,
  renderSettings,
} from './settings-test-support'

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
