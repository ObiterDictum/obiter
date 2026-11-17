import type { AgentThinkingLevel } from '@obiter/contracts'
import { cn } from '@obiter/ui'
import { thinkingName } from '../agent-models'

export function ThinkingChoice({
  label,
  levels,
  value,
  disabled,
  className,
  onChange,
}: {
  label: string
  levels: AgentThinkingLevel[]
  value: AgentThinkingLevel
  disabled?: boolean
  className?: string
  onChange: (level: AgentThinkingLevel) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 rounded-pill border border-line p-0.5',
        className,
      )}
    >
      {levels.map((level) => (
        <button
          key={level}
          type="button"
          role="radio"
          aria-checked={level === value}
          disabled={disabled}
          onClick={() => onChange(level)}
          className={cn(
            'rounded-pill px-2 py-0.5 text-caption focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-45',
            level === value
              ? 'bg-ink text-surface'
              : 'text-muted hover:text-ink',
          )}
        >
          {thinkingName(level)}
        </button>
      ))}
    </div>
  )
}
