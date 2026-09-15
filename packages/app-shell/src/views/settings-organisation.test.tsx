// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import type { MeResponse } from '@obiter/contracts'
import { ApiError } from '../api'
import {
  MEMBER_ME,
  ORGLESS_ME,
  OWNER_ME,
  idleMutation,
  openSection,
  readOnlyValue,
  renderSettings,
} from './settings-test-support'

/**
 * The Organisation section: rename, who may perform it, the read-only context,
 * the members and invites panel, and creation for a user with no organisation.
 * Permissions are asserted here and again server-side in
 * `services/api/src/account.db.test.ts`.
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

    expect(within(organisation).getByText(/apply to everyone in/i)).toBeTruthy()
  })

  it('shows the role and the stable identifier as read-only context', async () => {
    renderSettings()
    const organisation = await openSection('Organisation')

    expect(readOnlyValue(organisation, 'Your role')).toBe('Owner')
    expect(readOnlyValue(organisation, 'Organisation ID')).toBe('org_1')
  })

  it('shows a member the organisation without an editing control', async () => {
    signedIn(MEMBER_ME)
    renderSettings()
    const organisation = await openSection('Organisation')

    expect(within(organisation).getByText('Ashcombe Chambers')).toBeTruthy()
    expect(readOnlyValue(organisation, 'Your role')).toBe('Member')
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

    expect(readOnlyValue(organisation, 'Your role')).toBe('Admin')
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
