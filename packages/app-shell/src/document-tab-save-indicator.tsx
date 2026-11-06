import { Tooltip, TooltipContent, TooltipTrigger, cn } from '@obiter/ui'
import { Warning } from '@obiter/ui/icons'
import type { SaveStateLabel } from './components/document-workspace/document-save-state'

export function SaveStateMark({
  state,
  className,
}: {
  state: SaveStateLabel | null
  className?: string
}) {
  if (!state || state.indicator === 'none') return null
  if (state.indicator === 'danger' || state.indicator === 'warning') {
    return (
      <Warning
        size={11}
        aria-hidden
        data-save-indicator={state.indicator}
        className={cn(
          'shrink-0',
          state.indicator === 'danger' ? 'text-danger' : 'text-warning',
          className,
        )}
      />
    )
  }
  return (
    <span
      aria-hidden
      data-save-indicator={state.indicator}
      className={cn(
        'size-1.5 shrink-0 rounded-pill bg-ink',
        state.indicator === 'saving' &&
          'animate-pulse motion-reduce:animate-none',
        className,
      )}
    />
  )
}

export function DocumentTabSaveIndicator({
  state,
}: {
  state: SaveStateLabel | null
}) {
  if (!state) return null
  if (state.indicator === 'none') {
    return <span aria-hidden data-save-state={state.status} />
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            aria-label={state.label}
            data-save-state={state.status}
            className="inline-flex shrink-0 items-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          />
        }
      >
        <SaveStateMark state={state} />
      </TooltipTrigger>
      <TooltipContent side="bottom">{state.detail}</TooltipContent>
    </Tooltip>
  )
}
