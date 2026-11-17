import type { AgentAvailableModel, AgentThinkingLevel } from '@obiter/contracts'
import {
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
  Popover,
  PopoverTrigger,
  PopoverPortal,
  PopoverPositioner,
  PopoverPopup,
  Select,
} from '@obiter/ui'

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
  const thinkingControl = (
    <Select
      label="Thinking"
      value={thinking}
      options={model.thinkingLevels.map((value) => ({
        value,
        label: value[0]?.toUpperCase() + value.slice(1),
      }))}
      disabled={disabled}
      onValueChange={(value) => {
        const level = model.thinkingLevels.find((level) => level === value)
        if (level) onChange(model.id, level)
      }}
    />
  )
  const modelControl = (
    <Menu>
      <MenuTrigger
        disabled={disabled}
        className="rounded-md px-2 py-1 text-meta text-muted hover:bg-hover disabled:opacity-50"
      >
        {model.label}
      </MenuTrigger>
      <MenuContent align="start" aria-label="Model">
        {models.map((option) => (
          <MenuItem
            key={option.id}
            onClick={() =>
              onChange(
                option.id,
                option.thinkingLevels.includes(thinking)
                  ? thinking
                  : option.defaultThinking,
              )
            }
          >
            <span className="flex flex-col gap-1">
              <span className="text-ink">{option.label}</span>
              <span className="text-caption">{option.description}</span>
            </span>
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
  if (!compact)
    return (
      <div className="flex flex-wrap items-center gap-2">
        {modelControl}
        {thinkingControl}
      </div>
    )
  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        className="rounded-md px-2 py-1 text-caption text-muted hover:bg-hover disabled:opacity-50"
      >
        {model.label} · {thinking}
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverPositioner side="top" align="start" sideOffset={8}>
          <PopoverPopup
            className="flex w-72 flex-col gap-3 p-3"
            aria-label="Model and thinking"
          >
            {modelControl}
            {thinkingControl}
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  )
}
