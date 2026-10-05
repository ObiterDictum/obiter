import type { DocumentChangeWire } from '@obiter/contracts'
import { Button, EmptyState } from '@obiter/ui'

export function DocumentChangesPanel({
  changes,
  pending,
  error,
  onDecide,
}: {
  changes: DocumentChangeWire[]
  pending: boolean
  error: string | null
  onDecide: (action: 'accept' | 'reject', changeId: string) => void
}) {
  return (
    <aside
      className="flex w-full flex-col gap-5 lg:max-w-sm"
      aria-label="Tracked changes"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-ink">Tracked changes</h3>
        <p className="text-xs leading-relaxed text-muted">
          Accept or reject a change to write a new immutable version.
        </p>
      </div>
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {changes.length === 0 ? (
        <EmptyState
          title="No tracked changes"
          body="Edits saved with tracking on appear here with their author and date."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {changes.map((change) => (
            <li
              key={change.id}
              className="flex flex-col gap-2 border-t border-line pt-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-ink">
                  {change.author ?? 'Unknown author'}
                </p>
                <p className="font-mono text-[11px] text-subtle">
                  {change.date
                    ? new Date(change.date).toLocaleString()
                    : 'No date'}
                </p>
              </div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-subtle">
                {change.kind}
                {change.elementName ? ` · ${change.elementName}` : ''}
              </p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                {change.text || 'Property change'}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => onDecide('accept', change.id)}
                >
                  Accept
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => onDecide('reject', change.id)}
                >
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
