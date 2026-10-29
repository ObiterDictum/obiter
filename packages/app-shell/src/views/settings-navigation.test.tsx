import '@obiter/test-dom'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import type { MeResponse } from '@obiter/contracts'

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
  it('offers every section through section navigation and starts on Account', async () => {
    renderSettings()

    const nav = await screen.findByRole('navigation', {
      name: 'Settings sections',
    })
    expect(
      within(nav)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Account', 'Security', 'Organisation', 'Preferences'])

    expect(
      within(nav)
        .getByRole('button', { name: 'Account' })
        .getAttribute('aria-current'),
    ).toBe('true')
    expect(await screen.findByRole('region', { name: 'Account' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Security' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Organisation' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Preferences' })).toBeNull()
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

describe('SettingsRouteView — preferences', () => {
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('offers Light, Dark and Match system, and shows which one is in use', async () => {
    renderSettings()
    await openSection('Preferences')

    const theme = screen.getByRole('group', { name: 'Theme' })
    expect(
      within(theme)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Light (default)', 'Dark', 'Match system'])
    expect(
      within(theme)
        .getByRole('button', { name: 'Light (default)' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('keeps the choice and repaints the document to it', async () => {
    renderSettings()
    await openSection('Preferences')

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(window.localStorage.getItem('obiter.theme.v2')).toBe('dark')
    expect(
      screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed'),
    ).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Match system' }))

    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(window.localStorage.getItem('obiter.theme.v2')).toBe('system')
  })
})
