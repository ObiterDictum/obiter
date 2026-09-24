import '@obiter/test-dom'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import type { MeResponse } from '@obiter/contracts'

/**
 * Settings information architecture: the three sections, how they are reached,
 * and what survives moving between them. Account behaviour lives in
 * `settings-account.test.tsx`, password in `settings-security.test.tsx`, and
 * organisation and permissions in `settings-organisation.test.tsx`.
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
