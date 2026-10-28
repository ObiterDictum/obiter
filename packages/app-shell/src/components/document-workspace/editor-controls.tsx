import type { ReactNode } from 'react'
import { Check } from '@phosphor-icons/react'
import {
  Button,
  MenuItem,
  MenuRadioItem,
  Select,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@obiter/ui'

/**
 * The accessible name a control publishes: a plain label, the `soon` reason
 * (a literal one or the generic not-available wording), or the reason the
 * control is currently disabled. The toolbar, the menus and the command
 * palette all name a command the same way, so a query for "Bold" finds it
 * wherever it is offered.
 */
export function controlCaption(
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

export type EditorControl = {
  label: string
  pressed?: boolean
  disabled?: boolean
  soon?: boolean | string
  disabledReason?: string
  /** How a pressed toggle should read; `pressed` is the fallback. */
  hint?: string
  onClick?: () => void
}

/** A toolbar icon button: the compact measure of the old ribbon control. */
export function EditorIconButton({
  label,
  pressed,
  disabled,
  soon,
  disabledReason,
  hint,
  onClick,
  icon,
}: EditorControl & { icon: ReactNode }) {
  const unavailable = Boolean(soon)
  const caption = controlCaption(label, soon, disabled, disabledReason)
  const tooltip = hint ? `${caption}: ${hint}` : caption
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
        <Button
          variant={pressed ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 w-7 rounded-sm px-0 text-muted pointer-coarse:h-11 pointer-coarse:w-11"
          aria-label={caption}
          aria-pressed={pressed}
          disabled={disabled || unavailable}
          onClick={unavailable ? undefined : onClick}
          iconStart={icon}
        />
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

/** A short text button, for commands whose name is clearer than an icon. */
export function EditorTextButton({
  label,
  pressed,
  disabled,
  soon,
  disabledReason,
  onClick,
}: EditorControl) {
  const unavailable = Boolean(soon)
  const caption = controlCaption(label, soon, disabled, disabledReason)
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <Button
          variant={pressed ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 max-w-40 rounded-sm px-2 text-caption pointer-coarse:h-11"
          aria-label={caption}
          aria-pressed={pressed}
          disabled={disabled || unavailable}
          onClick={unavailable ? undefined : onClick}
        >
          {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{caption}</TooltipContent>
    </Tooltip>
  )
}

/**
 * A dropdown on the shared Base UI Select. `label` is the control's
 * accessible name; there is no visible label in the toolbar beside it — the
 * choices themselves say what they are.
 */
export function EditorSelect({
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
  soon?: boolean | string
  disabledReason?: string
  onChange?: (value: string) => void
  className?: string
}) {
  const unavailable = Boolean(soon)
  const caption = controlCaption(label, soon, disabled, disabledReason)
  return (
    <span className="inline-flex" title={caption}>
      <Select
        ariaLabel={caption}
        size="compact"
        value={value}
        placeholder={options.find((option) => option.value === value)?.label}
        options={[...options]}
        disabled={disabled || unavailable}
        onValueChange={(next) => {
          if (unavailable) return
          onChange?.(next ?? '')
        }}
        className={className}
      />
    </span>
  )
}

/** One menu row. A checked row is a radio choice, not a toggle button. */
export function EditorMenuItem({
  label,
  icon,
  hint,
  shortcut,
  pressed,
  checked,
  disabled,
  soon,
  disabledReason,
  onSelect,
  closeOnClick = true,
}: EditorControl & {
  icon?: ReactNode
  shortcut?: string
  checked?: boolean
  onSelect?: () => void
  closeOnClick?: boolean
}) {
  const unavailable = Boolean(soon)
  const caption = controlCaption(label, soon, disabled, disabledReason)
  const disabledNow = disabled || unavailable
  const children = (
    <>
      <span className="flex w-4 shrink-0 justify-center text-muted">
        {checked ? <Check size={14} aria-hidden /> : (icon ?? null)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block leading-snug">{caption}</span>
        {hint ? (
          <span className="block text-caption text-subtle">{hint}</span>
        ) : null}
      </span>
      {pressed !== undefined && !checked ? (
        <span className="text-caption text-subtle" aria-hidden>
          {pressed ? 'On' : 'Off'}
        </span>
      ) : null}
      {shortcut ? (
        <span className="shrink-0 font-mono text-caption text-subtle">
          {shortcut}
        </span>
      ) : null}
    </>
  )
  if (checked !== undefined) {
    return (
      <MenuRadioItem
        value={label}
        disabled={disabledNow}
        render={<button type="button" disabled={disabledNow} />}
        nativeButton
        role="button"
        aria-label={caption}
        aria-checked={Boolean(checked)}
        aria-pressed={Boolean(checked)}
        onClick={unavailable ? undefined : onSelect}
        className={cn(disabledNow && 'opacity-45')}
      >
        {children}
      </MenuRadioItem>
    )
  }
  return (
    <MenuItem
      disabled={disabledNow}
      // A real button so an assistive query for a named control finds a row in
      // the menu the same way it finds the toolbar's own control.
      render={<button type="button" disabled={disabledNow} />}
      nativeButton
      role="button"
      aria-label={caption}
      aria-pressed={pressed}
      closeOnClick={closeOnClick}
      onClick={unavailable ? undefined : onSelect}
      className={cn(disabledNow && 'opacity-45')}
    >
      {children}
    </MenuItem>
  )
}
