import { Folders, GearSix, Lock, Robot, User, Users } from '@obiter/ui/icons'
import { useRouterState } from '@tanstack/react-router'
import type { MeResponse } from '@obiter/contracts'

const always = () => true
const inOrganisation = (me: MeResponse) => me.organisation !== null

export const SETTINGS_SECTIONS = [
  {
    id: 'account',
    label: 'Account',
    icon: User,
    description:
      'Your name, sign-in email and the devices you are signed in on.',
    available: always,
  },
  {
    id: 'security',
    label: 'Security',
    icon: Lock,
    description: 'Your password and two-factor authentication.',
    available: always,
  },
  {
    id: 'preferences',
    label: 'Preferences',
    icon: GearSix,
    description: 'Appearance and other choices kept on this device.',
    available: always,
  },
  {
    id: 'organisation',
    label: 'Organisation',
    icon: Folders,
    description:
      'The organisation you work in, your role and the update policy.',
    available: always,
  },
  {
    id: 'members',
    label: 'Members',
    icon: Users,
    description:
      'Who is in your organisation and the invitations you have sent.',
    available: inOrganisation,
  },
  {
    id: 'agent',
    label: 'Agent',
    icon: Robot,
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

export function validateSettingsSearch(search: Record<string, unknown>): {
  section?: SettingsSectionId
} {
  const section = SETTINGS_SECTIONS.find((item) => item.id === search.section)
  return section ? { section: section.id } : {}
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
