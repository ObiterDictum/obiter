import { ChatCircle, X } from '@phosphor-icons/react'
import { Button, cn } from '@obiter/ui'
import { useState } from 'react'

/**
 * Floating Agent chat shell. UI-only for now — marked in development until
 * the agent backend ships. Available on every authenticated mode.
 */
export function AgentWidget() {
  const [open, setOpen] = useState(false)

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
      {open ? (
        <div
          className={cn(
            'pointer-events-auto flex h-[28rem] w-[22rem] flex-col overflow-hidden rounded-[0.85rem]',
            'border border-line bg-surface shadow-lg',
          )}
          role="dialog"
          aria-label="Agent"
        >
          <header className="flex items-center justify-between border-b border-line px-3 py-2.5">
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-semibold text-ink">Agent</p>
              <p className="text-[11px] text-subtle">In development</p>
            </div>
            <button
              type="button"
              aria-label="Close agent"
              onClick={() => setOpen(false)}
              className="rounded-md p-1.5 text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <X size={16} />
            </button>
          </header>
          <div className="flex flex-1 flex-col items-start justify-center gap-2 px-4 py-6">
            <p className="text-sm font-medium text-ink">
              Ask across the workspace
            </p>
            <p className="text-sm leading-relaxed text-muted">
              Agent will answer questions and draft against matter context when
              this surface ships. It is not available yet.
            </p>
          </div>
          <form
            className="border-t border-line p-3"
            onSubmit={(event) => event.preventDefault()}
          >
            <input
              type="text"
              disabled
              placeholder="Coming soon…"
              className="h-10 w-full rounded-md border border-line bg-canvas px-3 text-sm text-muted"
              aria-label="Agent message"
            />
          </form>
        </div>
      ) : null}

      <Button
        type="button"
        aria-label={open ? 'Close agent' : 'Open agent'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="pointer-events-auto h-11 w-11 rounded-pill p-0 shadow-md"
        iconStart={<ChatCircle size={20} weight="fill" />}
      />
    </div>
  )
}
