import { CheckCircle, Eye, EyeSlash } from '@phosphor-icons/react'
import { Input } from '@obiter/ui'
import { useState, type ReactNode, type RefObject } from 'react'
import type { CurrentUser } from '@obiter/contracts'

export function ReadOnlyField({
  label,
  value,
  helper,
}: {
  label: string
  value: ReactNode
  helper?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-meta text-ink">{label}</dt>
      <dd className="text-meta text-muted">{value}</dd>
      {helper ? <p className="text-caption text-subtle">{helper}</p> : null}
    </div>
  )
}

export function SectionHeading({
  id,
  title,
  description,
  level: Heading = 'h2',
}: {
  id: string
  title: string
  description: string
  level?: 'h2' | 'h3'
}) {
  return (
    <div>
      <Heading id={id} className="text-section text-ink">
        {title}
      </Heading>
      <p className="mt-1 max-w-[62ch] text-meta text-muted">{description}</p>
    </div>
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
    <p
      role="status"
      className="inline-flex items-center gap-1 text-caption text-success"
    >
      <CheckCircle size={12} aria-hidden />
      {message}
    </p>
  )
}

export function ErrorNotice({ message }: { message: string }) {
  return (
    <p role="alert" className="text-meta text-danger">
      {message}
    </p>
  )
}

export function roleLabel(role: NonNullable<CurrentUser['role']>) {
  return role.charAt(0).toUpperCase() + role.slice(1)
}
