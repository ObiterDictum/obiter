import { createContext, useContext, useState, type ReactNode } from 'react'
import type { SettingsSectionId } from './settings-sections'
import type { MatterStatusFilter } from './views/matters-rows'

interface ShellContentsState {
  settingsSection: SettingsSectionId
  setSettingsSection: (section: SettingsSectionId) => void
  mattersStatus: MatterStatusFilter
  setMattersStatus: (status: MatterStatusFilter) => void
}

const ShellContentsContext = createContext<ShellContentsState | null>(null)

export function ShellContentsProvider({ children }: { children: ReactNode }) {
  const [settingsSection, setSettingsSection] =
    useState<SettingsSectionId>('account')
  const [mattersStatus, setMattersStatus] =
    useState<MatterStatusFilter>('active')
  return (
    <ShellContentsContext.Provider
      value={{
        settingsSection,
        setSettingsSection,
        mattersStatus,
        setMattersStatus,
      }}
    >
      {children}
    </ShellContentsContext.Provider>
  )
}

export function useShellContents(): ShellContentsState {
  const shared = useContext(ShellContentsContext)
  const [settingsSection, setSettingsSection] =
    useState<SettingsSectionId>('account')
  const [mattersStatus, setMattersStatus] =
    useState<MatterStatusFilter>('active')
  return (
    shared ?? {
      settingsSection,
      setSettingsSection,
      mattersStatus,
      setMattersStatus,
    }
  )
}
