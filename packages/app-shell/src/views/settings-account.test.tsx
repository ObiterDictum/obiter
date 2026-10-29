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

const mocks = vi.hoisted(() => ({
  useCurrentUser: vi.fn(),
  useCreateOrganisation: vi.fn(),
  useRenameOrganisation: vi.fn(),
  useUpdateProfile: vi.fn(),
  useAuth: vi.fn(),
  navigate: vi.fn(),
}))

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

const currentUserModule = { ...(await import('../current-user')) }
mock.module('../current-user', () => ({
  ...currentUserModule,
  useCurrentUser: mocks.useCurrentUser,
  useCreateOrganisation: mocks.useCreateOrganisation,
  useRenameOrganisation: mocks.useRenameOrganisation,
  useUpdateProfile: mocks.useUpdateProfile,
}))

const authModule = { ...(await import('../auth')) }
mock.module('../auth', () => ({ ...authModule, useAuth: mocks.useAuth }))

const tanstackReactRouterModule = {
  ...(await import('@tanstack/react-router')),
}
mock.module('@tanstack/react-router', () => ({
  ...tanstackReactRouterModule,
  useNavigate: () => mocks.navigate,
}))

const { OWNER_ME, idleMutation, renderSettings } =
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
  it('shows the account identity with email read-only', async () => {
    renderSettings()
    const account = await screen.findByRole('region', { name: 'Account' })

    expect(within(account).getByLabelText('Name')).toBeTruthy()
    expect(within(account).getByText('owner@obiter.dev')).toBeTruthy()
    expect(within(account).queryByText('Your role')).toBeNull()
    expect(within(account).queryByText('Owner')).toBeNull()
    expect(
      within(account).getByText(/change the email you sign in with/i),
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
})
