import type { ReactNode } from 'react'
import {
  Button,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@obiter/ui'

export function RibbonTab({
  value,
  children,
}: {
  value: string
  children: ReactNode
}) {
  return (
    <TabsTrigger
      value={value}
      className={cn(
        'rounded-none border-b-2 border-transparent px-3 py-2 text-[13px] font-medium tracking-wide text-muted pointer-coarse:min-h-11 pointer-coarse:items-center',
        'hover:text-ink',
        'data-[selected]:border-brand data-[selected]:bg-transparent data-[selected]:text-ink',
      )}
    >
      {children}
    </TabsTrigger>
  )
}

export function ToolbarGroup({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-[3.25rem] shrink-0 items-stretch">
      <div className="flex flex-col items-center justify-between gap-1 px-2.5 py-0.5">
        <div className="flex flex-col items-center justify-center gap-0.5">
          {children}
        </div>
        <span className="text-[10px] leading-none font-medium tracking-wide text-subtle">
          {label}
        </span>
      </div>
      <div className="w-px self-stretch bg-line" aria-hidden />
    </div>
  )
}

export function ToolbarRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-0.5">{children}</div>
  )
}

/**
 * The accessible name a control publishes: a plain label, the `soon` reason
 * (a literal one or the generic not-available wording), or the reason the
 * control is currently disabled.
 */
function controlCaption(
  label: string,
  soon: boolean | string | undefined,
  disabled: boolean | undefined,
  disabledReason: string | undefined,
) {
  return typeof soon === 'string'
    ? `${label}: ${soon}`
    : soon
      ? `${label} (not available yet)`
      : disabled && disabledReason
        ? `${label}: ${disabledReason}`
        : label
}

export function IconButton({
  label,
  pressed,
  disabled,
  soon,
  disabledReason,
  hint,
  onClick,
  icon,
}: {
  label: string
  pressed?: boolean
  disabled?: boolean
  soon?: boolean | string
  disabledReason?: string
  /** What the action does beyond its label — shown in the tooltip, e.g.
   * the limits a share-safe export imposes. */
  hint?: string
  onClick?: () => void
  icon: ReactNode
}) {
  const unavailable = Boolean(soon)
  const caption = controlCaption(label, soon, disabled, disabledReason)
  // A hint discloses what the action does beyond its name — it lives in the
  // tooltip, not the accessible name, so `label` queries keep working.
  const tooltip = hint ? `${caption}: ${hint}` : caption
  const button = (
    <Button
      variant={pressed ? 'secondary' : 'ghost'}
      size="sm"
      className="h-7 w-7 px-0 pointer-coarse:h-11 pointer-coarse:w-11"
      aria-label={caption}
      aria-pressed={pressed}
      disabled={disabled || unavailable}
      onClick={unavailable ? undefined : onClick}
      iconStart={icon}
    />
  )
  // The span anchor keeps the tooltip alive when the button is disabled, as a
  // disabled button swallows the pointer events the trigger listens for.
  // preventDefault keeps the caret selection when Bold is pressed.
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="inline-flex"
            onMouseDown={(event) => event.preventDefault()}
          />
        }
      >
        {button}
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

export function CaptionButton({
  label,
  pressed,
  disabled,
  soon,
  disabledReason,
  onClick,
}: {
  label: string
  pressed?: boolean
  disabled?: boolean
  soon?: boolean
  /** The reason a currently-disabled control is unavailable, published in its
   * accessible name the way `IconButton` and `RibbonSelect` publish theirs. */
  disabledReason?: string
  onClick?: () => void
}) {
  const unavailable = Boolean(soon)
  const caption = controlCaption(label, soon, disabled, disabledReason)
  const button = (
    <Button
      variant={pressed ? 'secondary' : 'ghost'}
      size="sm"
      className="h-7 max-w-32 px-2 text-[11px] pointer-coarse:h-11"
      aria-label={caption}
      aria-pressed={pressed}
      disabled={disabled || unavailable}
      onClick={unavailable ? undefined : onClick}
    >
      {label}
    </Button>
  )
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        {button}
      </TooltipTrigger>
      <TooltipContent>{caption}</TooltipContent>
    </Tooltip>
  )
}

export function RibbonSelect({
  label,
  value,
  options,
  disabled,
  soon,
  disabledReason,
  onChange,
  className,
}: {
  label: string
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
  disabled?: boolean
  /** True for a not-yet control, or the reason a currently-unavailable one is
   * disabled (a tracked-change refusal), which its accessible name publishes. */
  soon?: boolean | string
  /** The reason a currently-disabled control is unavailable, announced in its
   * accessible name the same way `IconButton` publishes one. */
  disabledReason?: string
  onChange?: (value: string) => void
  className?: string
}) {
  const unavailable = Boolean(soon)
  const caption = controlCaption(label, soon, disabled, disabledReason)
  return (
    <select
      aria-label={caption}
      disabled={disabled || unavailable}
      className={cn(
        'h-7 rounded-md border border-line bg-canvas px-1.5 text-[12px] text-ink pointer-coarse:h-11',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      value={value}
      onChange={(event) => {
        if (unavailable) return
        onChange?.(event.target.value)
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
