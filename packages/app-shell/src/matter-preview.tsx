import {
  createContext,
  useContext,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react'
import type { MatterTab } from './matter-tabs'

export type MatterPreviewHandler = (tab: MatterTab) => void

const MatterPreviewContext =
  createContext<RefObject<MatterPreviewHandler | null> | null>(null)

export function MatterPreviewProvider({ children }: { children: ReactNode }) {
  const handler = useRef<MatterPreviewHandler | null>(null)
  return (
    <MatterPreviewContext.Provider value={handler}>
      {children}
    </MatterPreviewContext.Provider>
  )
}

export function useMatterPreviewRef() {
  return useContext(MatterPreviewContext)
}
