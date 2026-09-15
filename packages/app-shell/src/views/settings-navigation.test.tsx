// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import type { MeResponse } from '@obiter/contracts'
import {
  OWNER_ME,
  idleMutation,
  openSection,
  renderSettings,
} from './settings-test-support'

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
