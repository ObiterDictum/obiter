import { GearSix, Lock, User, Users } from '@obiter/ui/icons'
import { useRouterState } from '@tanstack/react-router'

export const SETTINGS_SECTIONS = [
  { id: 'account', label: 'Account', icon: User },
  { id: 'security', label: 'Security', icon: Lock },
  { id: 'organisation', label: 'Organisation', icon: Users },
  { id: 'preferences', label: 'Preferences', icon: GearSix },
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id']

export function settingsSectionFrom(value: unknown): SettingsSectionId {
  return SETTINGS_SECTIONS.find((item) => item.id === value)?.id ?? 'account'
}

export function validateSettingsSearch(search: Record<string, unknown>): {
  section?: SettingsSectionId
} {
  const section = SETTINGS_SECTIONS.find((item) => item.id === search.section)
  return section ? { section: section.id } : {}
}

export function useSettingsSection(): SettingsSectionId {
  return useRouterState({
    select: (state) =>
      settingsSectionFrom(
        new URLSearchParams(state.location.searchStr).get('section'),
      ),
  })
}
