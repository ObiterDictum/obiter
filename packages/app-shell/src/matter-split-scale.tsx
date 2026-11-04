import { createContext, useContext, type ReactNode } from 'react'

export type SplitScale = {
  pageZoom: number
  zoom: number
  onZoom: (next: number) => void
}

const PAPER_WIDTH = 794
const DIVIDER_WIDTH = 4
const DESK_GUTTER = 32
const MIN_ZOOM = 35

export function splitPageZoom(
  containerWidth: number | null,
  splitPercent: number,
  zoom: number,
) {
  if (containerWidth === null) return zoom
  const usable = Math.max(0, containerWidth - DIVIDER_WIDTH)
  const narrower = (usable * Math.min(splitPercent, 100 - splitPercent)) / 100
  const fit = Math.min(
    100,
    Math.floor(((narrower - DESK_GUTTER) / PAPER_WIDTH) * 100),
  )
  return Math.max(MIN_ZOOM, Math.round((zoom * fit) / 100))
}

const SplitScaleContext = createContext<SplitScale | null>(null)

export function SplitScaleProvider({
  scale,
  children,
}: {
  scale: SplitScale | null
  children: ReactNode
}) {
  return (
    <SplitScaleContext.Provider value={scale}>
      {children}
    </SplitScaleContext.Provider>
  )
}

export function useSplitScale() {
  return useContext(SplitScaleContext)
}
