// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import type { MeResponse } from '@obiter/contracts'
import {
  OWNER_ME,
  idleMutation,
  openSection,
  renderSettings,
} from './settings-test-support'

/**
 * The Security section: the password-change form. The hook it calls is pinned
 * in `../auth-change-password.test.tsx`, and the policy it states against the
 * API config in `../../../../services/api/src/password-policy.test.ts`.
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
      message: 'This account does not sign in with a password.',
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
