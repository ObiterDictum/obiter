import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'

export const SPLIT_DIVIDER_WIDTH = 4
const DESK_PADDING = 64

export type SplitPaneMetrics = {
  paneWidth: number
  scrollbarWidth: number
  paperWidth: number
}

type SplitScale = {
  pageZoom: number
  zoom: number
  onZoom: (next: number) => void
  reportPane: (paneId: string, metrics: SplitPaneMetrics | null) => void
  ribbonHeight: number
  reportRibbon: (height: number) => void
}

export function splitPaneFit({
  paneWidth,
  scrollbarWidth,
  paperWidth,
}: SplitPaneMetrics) {
  if (paperWidth <= 0) return 1
  const contentWidth = Math.max(0, paneWidth - scrollbarWidth - DESK_PADDING)
  return Math.min(1, contentWidth / paperWidth)
}

export function splitPageZoom(
  panes: readonly SplitPaneMetrics[],
  zoom: number,
) {
  if (panes.length === 0) return zoom
  const fit = Math.min(...panes.map(splitPaneFit))
  return Math.floor(zoom * fit)
}

function sameMetrics(a: SplitPaneMetrics, b: SplitPaneMetrics) {
  return (
    a.paneWidth === b.paneWidth &&
    a.scrollbarWidth === b.scrollbarWidth &&
    a.paperWidth === b.paperWidth
  )
}

const SplitScaleContext = createContext<SplitScale | null>(null)

export function SplitScaleProvider({
  active,
  zoom,
  onZoom,
  children,
}: {
  active: boolean
  zoom: number
  onZoom: (next: number) => void
  children: ReactNode
}) {
  const [panes, setPanes] = useState<ReadonlyMap<string, SplitPaneMetrics>>(
    () => new Map(),
  )
  const [ribbonHeight, setRibbonHeight] = useState(0)
  const reportPane = useCallback(
    (paneId: string, metrics: SplitPaneMetrics | null) => {
      setPanes((current) => {
        if (metrics === null) {
          if (!current.has(paneId)) return current
          const next = new Map(current)
          next.delete(paneId)
          return next
        }
        const existing = current.get(paneId)
        if (existing && sameMetrics(existing, metrics)) return current
        return new Map(current).set(paneId, metrics)
      })
    },
    [],
  )
  const reportRibbon = useCallback((height: number) => {
    setRibbonHeight((current) => (current === height ? current : height))
  }, [])
  const pageZoom = splitPageZoom([...panes.values()], zoom)
  const scale = useMemo(
    () =>
      active
        ? { pageZoom, zoom, onZoom, reportPane, ribbonHeight, reportRibbon }
        : null,
    [active, pageZoom, zoom, onZoom, reportPane, ribbonHeight, reportRibbon],
  )
  return (
    <SplitScaleContext.Provider value={scale}>
      {children}
    </SplitScaleContext.Provider>
  )
}

export function useSplitScale() {
  return useContext(SplitScaleContext)
}

export function useSplitDeskMetrics(
  deskRef: RefObject<HTMLElement | null>,
  paperWidth: number | null,
) {
  const reportPane = useSplitScale()?.reportPane
  const paneId = useId()
  useEffect(() => {
    if (!reportPane) return
    const desk = deskRef.current
    if (!desk || paperWidth === null) {
      reportPane(paneId, null)
      return () => reportPane(paneId, null)
    }
    const publish = () => {
      if (desk.offsetWidth === 0) {
        reportPane(paneId, null)
        return
      }
      reportPane(paneId, {
        paneWidth: desk.offsetWidth,
        scrollbarWidth: desk.offsetWidth - desk.clientWidth,
        paperWidth,
      })
    }
    publish()
    if (typeof ResizeObserver === 'undefined')
      return () => reportPane(paneId, null)
    const observer = new ResizeObserver(publish)
    observer.observe(desk)
    return () => {
      observer.disconnect()
      reportPane(paneId, null)
    }
  }, [deskRef, paperWidth, reportPane, paneId])
}

export function useSplitRibbonHeight(ribbonRef: RefObject<HTMLElement | null>) {
  const reportRibbon = useSplitScale()?.reportRibbon
  useEffect(() => {
    if (!reportRibbon) return
    const ribbon = ribbonRef.current
    if (!ribbon) return
    const publish = () => reportRibbon(ribbon.getBoundingClientRect().height)
    publish()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(publish)
    observer.observe(ribbon)
    return () => {
      observer.disconnect()
      reportRibbon(0)
    }
  }, [ribbonRef, reportRibbon])
}
