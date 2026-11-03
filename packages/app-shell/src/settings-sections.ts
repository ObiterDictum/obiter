import { GearSix, Lock, User, Users } from '@obiter/ui/icons'

export const SETTINGS_SECTIONS = [
  { id: 'account', label: 'Account', icon: User },
  { id: 'security', label: 'Security', icon: Lock },
  { id: 'organisation', label: 'Organisation', icon: Users },
  { id: 'preferences', label: 'Preferences', icon: GearSix },
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id']
