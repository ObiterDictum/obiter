import { useRef, useState } from 'react'
import type { LegalChecksFocus } from './ribbon-types'

/** The docked panels beside the paper. One is open at a time. */
export type WorkspacePanel =
  'info' | 'verify' | 'comments' | 'review' | 'authorities' | 'legal-checks'

export type WorkspacePanelState =
  | { panel: Exclude<WorkspacePanel, 'legal-checks'> }
  | { panel: 'legal-checks'; focus: LegalChecksFocus }

/**
 * Which docked panel is open and which control opened it.
 *
 * A docked panel is not modal, so nothing moves focus when it opens: the
 * trigger keeps it. Closing is the one path that moves focus, and it moves it
 * back to that trigger — captured from the control that had focus when the
 * panel was opened — so a keyboard user is never dropped onto `body`.
 */
export function useWorkspacePanels() {
  const [state, setState] = useState<WorkspacePanelState | null>(null)
  const trigger = useRef<HTMLElement | null>(null)

  function open(next: WorkspacePanelState) {
    const active = document.activeElement
    trigger.current = active instanceof HTMLElement ? active : null
    setState(next)
  }

  function toggle(panel: WorkspacePanel) {
    if (state?.panel === panel) {
      close()
      return
    }
    open(
      panel === 'legal-checks'
        ? {
            panel,
            focus: state?.panel === 'legal-checks' ? state.focus : 'terms',
          }
        : { panel },
    )
  }

  /** Open a panel without toggling it closed, keeping the opener for focus. */
  function openPanel(panel: WorkspacePanel) {
    if (state?.panel === panel) return
    open(panel === 'legal-checks' ? { panel, focus: 'terms' } : { panel })
  }

  /** Focus the legal-checks panel on a section, or move it between sections. */
  function openLegalChecks(focus: LegalChecksFocus) {
    if (state?.panel === 'legal-checks') {
      setState({ panel: 'legal-checks', focus })
      return
    }
    open({ panel: 'legal-checks', focus })
  }

  /** Close the open panel without moving focus (the caller already has it). */
  function dismiss() {
    trigger.current = null
    setState(null)
  }

  function close() {
    const target = trigger.current
    trigger.current = null
    setState(null)
    target?.focus()
  }

  return {
    state,
    active: state?.panel ?? null,
    legalChecksFocus: state?.panel === 'legal-checks' ? state.focus : null,
    toggle,
    open: openPanel,
    openLegalChecks,
    close,
    dismiss,
  }
}

/**
 * Whether an Escape keypress should close the open docked panel. It must not
 * steal the key from a dialog (which has its own dismissal), from the document
 * text (where Escape clears the caret), or from a field outside the panel
 * (where it is the platform's own cancel). Inside the panel it always closes.
 */
export function closesPanelOnEscape(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return true
  if (target.closest('[data-docked-panel]')) return true
  if (
    target.closest(
      '[role="dialog"], [data-paragraph-id], input, textarea, select, [contenteditable="true"]',
    )
  ) {
    return false
  }
  return true
}
