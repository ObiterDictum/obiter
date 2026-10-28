import { DockedPanel } from '@obiter/ui'
import { useEffect } from 'react'

/**
 * The Agent's placeholder. The design pass and the backend come first, so this
 * panel states what the agent will be and does nothing else: no invented
 * conversation, no disabled chat box, no floating launcher. It is docked beside
 * the page rather than over it, and the sidebar row that opens it is the only
 * way in.
 */
export function AgentPanel({ onClose }: { onClose: () => void }) {
  // Escape closes the panel wherever focus is. The panel is not modal, so focus
  // stays on the row that opened it until someone tabs in: a handler bound to
  // the panel alone would never see the key pressed on the trigger.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="flex min-h-0">
      <DockedPanel
        title="Agent"
        onClose={onClose}
        className="border-l border-line"
      >
        <p className="text-body text-muted">
          The Obiter agent is coming. It will work from the matter you have
          open: reading the documents, checking citations and answering
          questions with the sources it relied on.
        </p>
      </DockedPanel>
    </div>
  )
}
