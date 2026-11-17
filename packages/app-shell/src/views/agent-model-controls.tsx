import type { AgentAvailableModel, AgentThinkingLevel } from '@obiter/contracts'
import { useState } from 'react'
import {
  Popover,
  PopoverPortal,
  PopoverPopup,
  PopoverPositioner,
  PopoverTrigger,
  Switch,
  cn,
} from '@obiter/ui'
import { CaretDown, Check } from '@obiter/ui/icons'
import {
  offersThinking,
  shortModelLabel,
  thinksLonger,
  thinkingFor,
} from '../agent-models'

export function AgentModelControls({
  models,
  model,
  thinking,
  disabled,
  compact,
  onChange,
}: {
  models: AgentAvailableModel[]
  model: AgentAvailableModel
  thinking: AgentThinkingLevel
  disabled: boolean
  compact: boolean
  onChange: (model: string, thinking: AgentThinkingLevel) => void
}) {
  const [open, setOpen] = useState(false)
  const longer = thinksLonger(thinking)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          'inline-flex min-w-0 items-center gap-1 rounded-pill border border-line text-muted hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-45',
          compact ? 'h-6 px-2 text-caption' : 'h-7 px-2.5 text-meta',
        )}
      >
        <span className="truncate">
          {shortModelLabel(model.label)}
          {longer ? ' · Think longer' : ''}
        </span>
        <CaretDown size={12} aria-hidden className="shrink-0" />
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverPositioner side="top" align="start" sideOffset={8}>
          <PopoverPopup
            aria-label="Model and thinking"
            className="flex w-72 flex-col p-2"
          >
            <div role="radiogroup" aria-label="Model" className="flex flex-col">
              {models.map((option) => {
                const selected = option.id === model.id
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      onChange(option.id, thinkingFor(option, longer))
                      setOpen(false)
                    }}
                    className={cn(
                      'flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring',
                      selected && 'bg-brand-soft',
                    )}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="text-item text-ink">
                        {shortModelLabel(option.label)}
                      </span>
                      <span className="text-caption text-muted">
                        {option.description}
                      </span>
                    </span>
                    {selected ? (
                      <Check
                        size={14}
                        weight="bold"
                        aria-hidden
                        className="ml-auto shrink-0 text-brand"
                      />
                    ) : null}
                  </button>
                )
              })}
            </div>
            {offersThinking(model) ? (
              <>
                <span aria-hidden className="my-1 h-px bg-line" />
                <div className="flex items-center gap-3 rounded-md px-2 py-1.5">
                  <span className="flex min-w-0 flex-col">
                    <span className="text-item text-ink">Think longer</span>
                    <span className="text-caption text-muted">
                      Slower, more careful answers
                    </span>
                  </span>
                  <Switch
                    label="Think longer"
                    checked={longer}
                    className="ml-auto shrink-0"
                    onCheckedChange={(next) =>
                      onChange(model.id, thinkingFor(model, next))
                    }
                  />
                </div>
              </>
            ) : null}
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  )
}
