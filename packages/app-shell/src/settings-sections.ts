import { useRouterState } from '@tanstack/react-router'
import type { MeResponse } from '@obiter/contracts'

const always = () => true
const inOrganisation = (me: MeResponse) => me.organisation !== null

export const SETTINGS_SECTIONS = [
  {
    id: 'account',
    label: 'Account',
    description:
      'Your name, sign-in email and the devices you are signed in on.',
    available: always,
  },
  {
    id: 'security',
    label: 'Security',
    description: 'Your password and two-factor authentication.',
    available: always,
  },
  {
    id: 'preferences',
    label: 'Preferences',
    description: 'Appearance and other choices kept on this device.',
    available: always,
  },
  {
    id: 'organisation',
    label: 'Organisation',
    description:
      'The organisation you work in, your role and the update policy.',
    available: always,
  },
  {
    id: 'members',
    label: 'Members',
    description:
      'Who is in your organisation and the invitations you have sent.',
    available: inOrganisation,
  },
  {
    id: 'integrations',
    label: 'Integrations',
    description:
      'Connect the tools your team already uses so the agent can work where you do.',
    available: inOrganisation,
  },
  {
    id: 'agent',
    label: 'Agent',
    description:
      "The model provider your organisation's agent uses and what it may send.",
    available: inOrganisation,
  },
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id']

export function settingsSectionFrom(
  value: unknown,
  me: MeResponse | undefined,
): SettingsSectionId {
  return (
    SETTINGS_SECTIONS.find(
      (item) => item.id === value && (!me || item.available(me)),
    )?.id ?? 'account'
  )
}

export function validateSettingsSearch(search: Record<string, unknown>) {
  const section = SETTINGS_SECTIONS.find((item) => item.id === search.section)
  const integration =
    typeof search.integration === 'string' &&
    /^[a-z0-9-]{1,64}$/.test(search.integration)
      ? search.integration
      : undefined
  return {
    ...(section ? { section: section.id } : {}),
    ...(integration ? { integration } : {}),
  }
}

export function useSettingsSection(
  me: MeResponse | undefined,
): SettingsSectionId {
  return useRouterState({
    select: (state) =>
      settingsSectionFrom(
        new URLSearchParams(state.location.searchStr).get('section'),
        me,
      ),
  })
}
