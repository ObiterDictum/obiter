import { createContext, useContext, useState, type ReactNode } from 'react'
import type { MatterStatusFilter } from './views/matters-rows'

interface ShellContentsState {
  mattersStatus: MatterStatusFilter
  setMattersStatus: (status: MatterStatusFilter) => void
}

const ShellContentsContext = createContext<ShellContentsState | null>(null)

export function ShellContentsProvider({ children }: { children: ReactNode }) {
  const [mattersStatus, setMattersStatus] =
    useState<MatterStatusFilter>('active')
  return (
    <ShellContentsContext.Provider value={{ mattersStatus, setMattersStatus }}>
      {children}
    </ShellContentsContext.Provider>
  )
}

export function useShellContents(): ShellContentsState {
  const shared = useContext(ShellContentsContext)
  const [mattersStatus, setMattersStatus] =
    useState<MatterStatusFilter>('active')
  return shared ?? { mattersStatus, setMattersStatus }
}
