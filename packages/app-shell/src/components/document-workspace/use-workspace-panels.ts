import { useRef, useState } from 'react'
import type { PanelPopout, PanelPosition } from '@obiter/ui'
import { useMediaQuery } from '../../use-media-query'
import {
  documentWorkspaceKeyDown,
  type WorkspaceKeyEvent,
  type WorkspaceKeySources,
} from '../../document-workspace-keys'
import {
  useShowRightSlotTab,
  useShownRightSlotTab,
  type DocumentPanelTab,
} from '../../right-slot-portal'
import type { LegalChecksFocus } from './ribbon-types'

export type WorkspacePanel = 'info' | 'verify' | 'review' | 'authorities'

type RightSlotTab = Exclude<DocumentPanelTab, 'history'>

type Placements = Partial<
  Record<WorkspacePanel, PanelPosition & { floating: boolean }>
>

const PLACEMENT_KEY = 'obiter.editor.panel-placement'

function readPlacements(): Placements {
  if (typeof localStorage === 'undefined') return {}
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(PLACEMENT_KEY) ?? '{}',
    )
    // SAFETY: the stored value is this module's own JSON; a malformed shape
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Placements)
      : {}
  } catch {
    return {}
  }
}

function writePlacements(placements: Placements) {
  try {
    localStorage.setItem(PLACEMENT_KEY, JSON.stringify(placements))
  } catch {}
}

function chromeBottom() {
  if (typeof document === 'undefined') return 8
  const toolbar = document.querySelector('[data-editor-toolbar]')
  const bottom = toolbar?.getBoundingClientRect().bottom
  return bottom === undefined ? 8 : Math.round(bottom) + 8
}

function defaultPosition(): PanelPosition {
  if (typeof window === 'undefined') return { x: 0, y: 0 }
  return { x: Math.max(8, window.innerWidth - 404), y: chromeBottom() }
}

export function useWorkspacePanels() {
  const [active, setActive] = useState<WorkspacePanel | null>(null)
  const [placements, setPlacements] = useState<Placements>(readPlacements)
  const [checksFocus, setChecksFocus] = useState<LegalChecksFocus | null>(null)
  const wide = useMediaQuery('(min-width: 1280px)')
  const trigger = useRef<HTMLElement | null>(null)
  const tabTrigger = useRef<HTMLElement | null>(null)
  const shownTab = useShownRightSlotTab()
  const showTab = useShowRightSlotTab()

  function focusedElement() {
    const element = document.activeElement
    return element instanceof HTMLElement ? element : null
  }

  function open(next: WorkspacePanel) {
    trigger.current = focusedElement()
    setActive(next)
  }

  function toggle(panel: WorkspacePanel) {
    if (active === panel) {
      close()
      return
    }
    open(panel)
  }

  function openPanel(panel: WorkspacePanel) {
    if (active === panel) return
    open(panel)
  }

  function openTab(tab: RightSlotTab) {
    if (shownTab === tab) return
    tabTrigger.current = focusedElement()
    showTab?.(tab)
  }

  function toggleTab(tab: RightSlotTab) {
    if (shownTab === tab) {
      closeTab()
      return
    }
    setChecksFocus(null)
    openTab(tab)
  }

  function closeTab() {
    const target = tabTrigger.current
    tabTrigger.current = null
    setChecksFocus(null)
    showTab?.(null)
    target?.focus()
  }

  function closeOnEscape(target: EventTarget | null) {
    if (shownTab === null || tabTrigger.current === null) return false
    if (!inRightSlotTab(target)) return false
    closeTab()
    return true
  }

  function openLegalChecks(focus: LegalChecksFocus) {
    setChecksFocus(focus)
    openTab('checks')
  }

  function dismiss() {
    trigger.current = null
    setActive(null)
  }

  function close() {
    const target = trigger.current
    trigger.current = null
    setActive(null)
    target?.focus()
  }

  function update(
    panel: WorkspacePanel,
    change: (current: Placements[WorkspacePanel]) => Placements[WorkspacePanel],
  ) {
    setPlacements((current) => {
      const next = { ...current, [panel]: change(current[panel]) }
      writePlacements(next)
      return next
    })
  }

  function popout(panel: WorkspacePanel): PanelPopout {
    const placement = placements[panel]
    const minTop = chromeBottom()
    const position = placement ?? { ...defaultPosition(), floating: false }
    return {
      mode: wide && placement?.floating ? 'floating' : 'docked',
      position: { x: position.x, y: Math.max(position.y, minTop) },
      canFloat: wide,
      minTop,
      onToggle: () =>
        update(panel, (current) => ({
          ...defaultPosition(),
          ...current,
          floating: !current?.floating,
        })),
      onMove: (next) => update(panel, () => ({ ...next, floating: true })),
    }
  }

  return {
    active,
    tabs: {
      shown: shownTab,
      available: showTab !== null,
      checksFocus,
      open: openTab,
      toggle: toggleTab,
      close: closeTab,
      closeOnEscape,
      openLegalChecks,
    },
    toggle,
    open: openPanel,
    close,
    dismiss,
    popout,
  }
}

export function workspaceKeyDown(
  event: WorkspaceKeyEvent,
  {
    panels,
    save,
    undo,
    redo,
    print,
    format,
    request,
    review,
  }: {
    panels: ReturnType<typeof useWorkspacePanels>
    save: () => void
    undo: () => void
    redo: () => void
    print: () => void
    format?: WorkspaceKeySources['format']
    request: (surface: 'find' | 'palette' | 'formatting') => void
    review: {
      decideCurrent: (action: 'accept' | 'reject') => void
      goToNext: () => void
      goToPrevious: () => void
    }
  },
) {
  if (
    event.key === 'Escape' &&
    panels.tabs.closeOnEscape(event.target ?? null)
  ) {
    event.preventDefault()
    return
  }
  if (
    event.key === 'Escape' &&
    panels.active !== null &&
    closesPanelOnEscape(event.target ?? null)
  ) {
    event.preventDefault()
    panels.close()
    return
  }
  documentWorkspaceKeyDown(event, {
    save,
    undo,
    redo,
    print,
    format,
    openFind: () => request('find'),
    openPalette: () => request('palette'),
    openFormatting: () => request('formatting'),
    review:
      panels.active === 'review'
        ? {
            onAccept: () => review.decideCurrent('accept'),
            onReject: () => review.decideCurrent('reject'),
            onNext: review.goToNext,
            onPrevious: review.goToPrevious,
          }
        : undefined,
  })
}

function inRightSlotTab(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    target.closest('[data-right-slot-tab]') !== null
  )
}

export function closesPanelOnEscape(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return true
  if (target.closest('[data-docked-panel]')) return true
  if (
    target.closest(
      '[role="dialog"], [role="menu"], [role="listbox"], [data-paragraph-id], input, textarea, select, [contenteditable="true"]',
    )
  ) {
    return false
  }
  return true
}
