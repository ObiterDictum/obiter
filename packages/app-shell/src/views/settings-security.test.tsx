import '@obiter/test-dom'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import type { MeResponse } from '@obiter/contracts'

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
const { OWNER_ME, idleMutation, openSection, renderSettings } =
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
