import { Eye, EyeSlash } from '@phosphor-icons/react'
import { Input } from '@obiter/ui'
import { useState, type ReactNode, type RefObject } from 'react'
import type { CurrentUser } from '@obiter/contracts'

/**
 * Field primitives shared by the Settings sections: a read-only value, a
 * heading with its description, a password field with a visibility control,
 * and the two message slots every form uses.
 */

export function ReadOnlyField({
  label,
  value,
  helper,
  mono,
}: {
  label: string
  value: ReactNode
  helper?: ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm font-medium text-ink">{label}</dt>
      <dd
        className={
          mono ? 'font-mono text-[13px] text-muted' : 'text-sm text-muted'
        }
      >
        {value}
      </dd>
      {helper ? <p className="text-xs leading-4 text-muted">{helper}</p> : null}
    </div>
  )
}

export function SectionHeading({
  id,
  title,
  description,
}: {
  id: string
  title: string
  description: string
}) {
  return (
    <>
      <h2 id={id} className="text-base font-semibold tracking-tight text-ink">
        {title}
      </h2>
      <p className="mt-1 text-sm text-muted">{description}</p>
    </>
  )
}

export function PasswordField({
  inputRef,
  label,
  autoComplete,
  value,
  onChange,
  helperText,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  label: string
  autoComplete: 'current-password' | 'new-password'
  value: string
  onChange: (value: string) => void
  helperText?: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <Input
      ref={inputRef}
      label={label}
      type={visible ? 'text' : 'password'}
      autoComplete={autoComplete}
      required
      value={value}
      onChange={(event) => onChange(event.target.value)}
      helperText={helperText}
      trailing={
        <button
          type="button"
          aria-label={
            visible
              ? `Hide ${label.toLowerCase()}`
              : `Show ${label.toLowerCase()}`
          }
          aria-pressed={visible}
          onClick={() => setVisible((shown) => !shown)}
          className="pointer-events-auto rounded p-1 text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {visible ? <EyeSlash size={16} /> : <Eye size={16} />}
        </button>
      }
    />
  )
}

export function SavedNotice({
  message,
  show,
}: {
  message: string
  show: boolean
}) {
  if (!show) return null
  return (
    <p role="status" className="text-sm text-success">
      {message}
    </p>
  )
}

export function ErrorNotice({ message }: { message: string }) {
  return (
    <p role="alert" className="text-sm text-danger">
      {message}
    </p>
  )
}

export function roleLabel(role: NonNullable<CurrentUser['role']>) {
  return role.charAt(0).toUpperCase() + role.slice(1)
}
