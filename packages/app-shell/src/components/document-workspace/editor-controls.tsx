import { useId, type ReactNode } from 'react'
import { Check } from '@phosphor-icons/react'
import {
  Button,
  MenuCheckboxItem,
  MenuItem,
  MenuRadioItem,
  Select,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@obiter/ui'

/**
 * Why a control cannot run right now: the `soon` reason (a literal one or the
 * generic not-available wording), or the reason it is disabled. A control's
 * name is its command name wherever it is offered; the reason is a description
 * beside it, never part of the name, so "Accept change" keeps that name in a
 * menu row, a tooltip and a screen reader alike.
 */
export function controlReason(
  soon: boolean | string | undefined,
  disabled: boolean | undefined,
  disabledReason: string | undefined,
) {
  if (typeof soon === 'string') return soon
  if (soon) return 'Not available yet.'
  return disabled ? disabledReason : undefined
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
  const reason = controlReason(soon, disabled, disabledReason)
  const tooltip = reason ?? hint ?? label
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
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled || unavailable}
          title={reason}
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
  const tooltip = controlReason(soon, disabled, disabledReason) ?? label
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <Button
          variant={pressed ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 max-w-40 rounded-sm px-2 text-caption pointer-coarse:h-11"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled || unavailable}
          title={tooltip === label ? undefined : tooltip}
          onClick={unavailable ? undefined : onClick}
        >
          {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
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
  placeholder,
  className,
}: {
  label: string
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
  disabled?: boolean
  soon?: boolean | string
  disabledReason?: string
  onChange?: (value: string) => void
  /** Shown for a value no option names; the current option label otherwise. */
  placeholder?: string
  className?: string
}) {
  const unavailable = Boolean(soon)
  const reason = controlReason(soon, disabled, disabledReason)
  const selected = options.find((option) => option.value === value)?.label
  return (
    <span className="inline-flex" title={reason ?? label}>
      <Select
        ariaLabel={label}
        size="compact"
        value={value}
        placeholder={selected ?? placeholder}
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

/** How a menu row behaves: a command, an on/off toggle, or a radio choice. */
export type EditorMenuItemKind = 'action' | 'toggle' | 'radio'

/**
 * One menu row, built on the Base UI menu item so the menu keeps real
 * `menuitem`, `menuitemcheckbox` and `menuitemradio` semantics: arrow keys,
 * typeahead, the checked state and Escape-back-to-trigger all come from the
 * primitive. The visible label is always the command's name; a reason the row
 * cannot run is a second line described by the row, not appended to its name.
 */
export function EditorMenuItem({
  label,
  icon,
  hint,
  shortcut,
  pressed,
  checked,
  kind,
  disabled,
  soon,
  disabledReason,
  onSelect,
  closeOnClick = true,
}: EditorControl & {
  icon?: ReactNode
  shortcut?: string
  checked?: boolean
  kind?: EditorMenuItemKind
  onSelect?: () => void
  closeOnClick?: boolean
}) {
  const unavailable = Boolean(soon)
  const disabledNow = disabled || unavailable
  const reason = controlReason(soon, disabled, disabledReason)
  const descriptionId = useId()
  const row =
    kind ??
    (checked !== undefined
      ? 'radio'
      : pressed !== undefined
        ? 'toggle'
        : 'action')
  const children = (
    <>
      <span className="flex w-4 shrink-0 justify-center text-muted">
        {checked ? <Check size={14} aria-hidden /> : (icon ?? null)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block leading-snug">{label}</span>
        {reason ? (
          <span id={descriptionId} className="block text-caption text-subtle">
            {reason}
          </span>
        ) : hint ? (
          <span className="block text-caption text-subtle">{hint}</span>
        ) : null}
      </span>
      {pressed !== undefined && !checked ? (
        <span className="text-caption text-subtle" aria-hidden>
          {pressed ? 'On' : 'Off'}
        </span>
      ) : null}
      {shortcut ? (
        <span
          aria-hidden
          className="shrink-0 font-mono text-caption text-subtle"
        >
          {shortcut}
        </span>
      ) : null}
    </>
  )
  const shared = {
    // A real button element so the row activates and focuses like one; the
    // role stays the menu role Base UI gives it.
    render: <button type="button" />,
    nativeButton: true,
    'aria-label': label,
    'aria-describedby': reason ? descriptionId : undefined,
    className: cn(disabledNow && 'opacity-45'),
    closeOnClick,
  }
  if (row === 'radio') {
    return (
      <MenuRadioItem
        {...shared}
        value={label}
        disabled={disabledNow}
        onClick={unavailable ? undefined : onSelect}
      >
        {children}
      </MenuRadioItem>
    )
  }
  if (row === 'toggle') {
    return (
      <MenuCheckboxItem
        {...shared}
        checked={Boolean(pressed)}
        disabled={disabledNow}
        onCheckedChange={() => {
          if (!unavailable) onSelect?.()
        }}
      >
        {children}
      </MenuCheckboxItem>
    )
  }
  return (
    <MenuItem
      {...shared}
      disabled={disabledNow}
      onClick={unavailable ? undefined : onSelect}
    >
      {children}
    </MenuItem>
  )
}
