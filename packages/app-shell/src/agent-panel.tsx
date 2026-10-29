import { DockedPanel } from '@obiter/ui'
import { useEffect } from 'react'

export function AgentPanel({ onClose }: { onClose: () => void }) {
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
