import { useState, type ReactNode } from 'react'
import { DotsThree } from '@phosphor-icons/react'
import {
  Button,
  Popover,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@obiter/ui'
import { useMediaQuery } from '../../use-media-query'

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
        'relative -mb-px h-[34px] rounded-none border-b-2 border-transparent px-3 text-caption text-subtle pointer-coarse:min-h-11',
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
    <div className="flex shrink-0 items-stretch">
      <div className="flex min-h-12 flex-col items-center justify-between gap-1 px-1 py-1 first:ps-10 max-compact:first:ps-6">
        <div className="flex flex-col items-center justify-center gap-1">
          {children}
        </div>
        <span className="text-caption leading-none whitespace-nowrap text-subtle">
          {label}
        </span>
      </div>
      <div className="w-px self-stretch bg-line" aria-hidden />
    </div>
  )
}

export function ToolbarRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-px">{children}</div>
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
      className="h-6 w-6 rounded-sm px-0 text-muted pointer-coarse:h-11 pointer-coarse:w-11"
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
      className="h-6 max-w-32 rounded-sm px-1.5 text-caption pointer-coarse:h-11"
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
        'h-6 rounded-sm border-0 bg-fill px-1.5 text-caption text-muted pointer-coarse:h-11',
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

/**
 * RibbonSecondary — the groups a narrow window drops from the row.
 *
 * At 1440 every group is inline, as the mock-up shows. At 1024 and under the
 * row would wrap, so the secondary groups move into one "More" popover instead:
 * the same groups, the same controls, one extra click. The popover is
 * non-modal, so the document stays visible and editable behind it.
 */
export function RibbonSecondary({
  children,
  label,
}: {
  children: ReactNode
  label: string
}) {
  const compact = useMediaQuery('(max-width: 1024px)')
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  if (!compact) return <>{children}</>
  return (
    <div className="ml-auto flex shrink-0 items-stretch">
      <div className="flex min-h-12 flex-col items-center justify-between gap-1 px-3 py-1">
        <div className="flex min-h-6 items-center">
          <Button
            ref={setAnchor}
            variant="ghost"
            size="sm"
            aria-label={label}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            iconStart={<DotsThree size={16} aria-hidden />}
          >
            More
          </Button>
        </div>
        <span aria-hidden className="text-caption leading-none text-subtle">
          More
        </span>
      </div>
      <div className="w-px self-stretch bg-line" aria-hidden />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverPortal>
          <PopoverPositioner anchor={anchor} side="bottom" align="end">
            <PopoverPopup
              aria-label={label}
              className="flex max-w-[min(100vw-var(--obiter-space-24),42rem)] flex-wrap items-stretch p-1"
            >
              {children}
            </PopoverPopup>
          </PopoverPositioner>
        </PopoverPortal>
      </Popover>
    </div>
  )
}
