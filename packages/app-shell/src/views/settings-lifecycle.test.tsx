import '@obiter/test-dom'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import type { MeResponse, OrganisationMember } from '@obiter/contracts'

const mocks = vi.hoisted(() => ({
  useCurrentUser: vi.fn(),
  useCreateOrganisation: vi.fn(),
  useRenameOrganisation: vi.fn(),
  useUpdateProfile: vi.fn(),
  useAuth: vi.fn(),
  navigate: vi.fn(),
  updateRole: vi.fn(),
  transferOwnership: vi.fn(),
  leaveOrganisation: vi.fn(),
}))

const MEMBERS: OrganisationMember[] = [
  {
    id: 'usr_1',
    name: 'Imogen Hartley',
    email: 'owner@obiter.dev',
    role: 'owner',
  },
  {
    id: 'usr_3',
    name: 'Callum Whitfield',
    email: 'member@obiter.dev',
    role: 'member',
  },
]

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
      useOrganisationMembers: () => ({
        data: MEMBERS,
        isPending: false,
        isError: false,
        isSuccess: true,
        refetch: vi.fn(),
      }),
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
      useUpdateOrganisationMemberRole: () => ({
        mutate: mocks.updateRole,
        isPending: false,
        isError: false,
      }),
      useTransferOrganisationOwnership: () => ({
        mutateAsync: mocks.transferOwnership,
        isPending: false,
      }),
      useLeaveOrganisation: () => ({
        mutateAsync: mocks.leaveOrganisation,
        isPending: false,
      }),
    }))(),
  ),
)

const matterOwnershipModule = { ...(await import('../matter-ownership')) }
mock.module('../matter-ownership', () => ({
  ...matterOwnershipModule,
  useMemberOwnedMatters: () => ({
    data: [],
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  }),
}))

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

const { MEMBER_ME, OWNER_ME, idleMutation, openSection, renderSettings } =
  await import('./settings-test-support')

function signedIn(user: MeResponse = OWNER_ME) {
  mocks.useCurrentUser.mockReturnValue({ data: user })
  mocks.useCreateOrganisation.mockReturnValue(idleMutation())
  mocks.useRenameOrganisation.mockReturnValue(idleMutation())
  mocks.useUpdateProfile.mockReturnValue(idleMutation())
  mocks.useAuth.mockReturnValue({
    changeEmail: vi.fn().mockResolvedValue({ ok: true }),
    deleteAccount: vi.fn().mockResolvedValue({ ok: true }),
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

describe('SettingsRouteView — member list visibility', () => {
  it('shows a plain member the list read-only with no management controls', async () => {
    signedIn(MEMBER_ME)
    renderSettings()
    const members = await openSection('Members')

    expect(within(members).getByText('Imogen Hartley')).toBeTruthy()
    expect(within(members).getByText('Callum Whitfield')).toBeTruthy()
    expect(
      within(members).queryByLabelText('Role for Callum Whitfield'),
    ).toBeNull()
    expect(within(members).queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(
      within(members).queryByRole('button', { name: 'Send invite' }),
    ).toBeNull()
    expect(within(members).queryByText('Pending invites')).toBeNull()
  })

  it('shows the owner a role control per changeable member and remove actions', async () => {
    renderSettings()
    const members = await openSection('Members')

    expect(
      within(members).getByLabelText('Role for Callum Whitfield'),
    ).toBeTruthy()
    expect(
      within(members).queryByLabelText('Role for Imogen Hartley'),
    ).toBeNull()
    expect(
      within(members).getAllByRole('button', { name: 'Remove' }),
    ).toHaveLength(1)
  })
})

describe('SettingsRouteView — ownership and leaving', () => {
  it('offers transfer ownership to the owner and no leave control', async () => {
    renderSettings()
    const organisation = await openSection('Organisation')

    expect(
      within(organisation).getByRole('button', {
        name: 'Transfer ownership',
      }),
    ).toBeTruthy()
    expect(
      within(organisation).queryByRole('button', {
        name: 'Leave organisation',
      }),
    ).toBeNull()
    expect(
      within(organisation).getByText(/transfer ownership before you leave/i),
    ).toBeTruthy()
  })

  it('offers leave organisation to a non-owner member', async () => {
    signedIn(MEMBER_ME)
    renderSettings()
    const organisation = await openSection('Organisation')

    expect(
      within(organisation).getByRole('button', {
        name: 'Leave organisation',
      }),
    ).toBeTruthy()
    expect(
      within(organisation).queryByRole('button', {
        name: 'Transfer ownership',
      }),
    ).toBeNull()
  })
})

describe('SettingsRouteView — account lifecycle', () => {
  it('offers change email and delete account on the Account section', async () => {
    renderSettings()
    const account = await openSection('Account')

    expect(
      within(account).getByRole('button', { name: 'Change email' }),
    ).toBeTruthy()
    expect(
      within(account).getByRole('button', { name: 'Delete account' }),
    ).toBeTruthy()
    expect(
      within(account).queryByText(/ask your firm administrator/i),
    ).toBeNull()
  })

  it('requires the typed email before account deletion can be confirmed', async () => {
    renderSettings()
    const account = await openSection('Account')
    fireEvent.click(
      within(account).getByRole('button', { name: 'Delete account' }),
    )

    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', {
      name: 'Delete account',
    }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)

    fireEvent.change(within(dialog).getByLabelText(/Type .* to confirm/), {
      target: { value: 'owner@obiter.dev' },
    })
    fireEvent.change(within(dialog).getByLabelText('Password'), {
      target: { value: 'correct horse' },
    })
    expect(confirm.disabled).toBe(false)
  })
})
