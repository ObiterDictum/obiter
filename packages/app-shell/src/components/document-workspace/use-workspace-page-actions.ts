import { useEffect, useRef } from 'react'
import type { VerifyPanelRequest } from '../verification/verification-context'
import { isForeignFormField } from '../../document-workspace-keys'
import { isPrimaryModifier } from '../../keyboard-platform'
import { useLatestCallback } from './use-latest-callback'
import type { useWorkspacePanels, WorkspacePanel } from './use-workspace-panels'
import type { useWorkspaceView } from './use-workspace-view'

export function useWorkspacePageActions(
  workspace: ReturnType<typeof useWorkspaceView>,
  panels: ReturnType<typeof useWorkspacePanels>,
  verifyRequest: VerifyPanelRequest | null | undefined,
) {
  const { navOpen, toggleNavPane, request } = workspace
  const verifySeq = useRef(0)
  useEffect(() => {
    if (!verifyRequest || verifyRequest.seq === verifySeq.current) return
    verifySeq.current = verifyRequest.seq
    panels.open('verify')
  }, [verifyRequest, panels])

  function togglePanel(panel: WorkspacePanel) {
    if (navOpen) toggleNavPane()
    panels.toggle(panel)
  }
  function toggleNavigation() {
    if (!navOpen) panels.dismiss()
    toggleNavPane()
  }
  const openPalette = useLatestCallback(() => request('palette'))
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return
      if (!isPrimaryModifier(event) || !event.shiftKey) return
      if (event.key.toLowerCase() !== 'p') return
      if (isForeignFormField(event.target)) return
      event.preventDefault()
      openPalette()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openPalette])

  const commentSelection = useLatestCallback(() => panels.tabs.open('comments'))
  const reviewPanel = useLatestCallback(() => togglePanel('review'))

  return { togglePanel, toggleNavigation, commentSelection, reviewPanel }
}
