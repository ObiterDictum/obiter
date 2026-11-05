import { Link, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Button, buttonClassName, cn } from '@obiter/ui'
import { CheckCircle, Clock, Warning } from '@obiter/ui/icons'
import type { ReactNode } from 'react'
import type { ConfirmAccessRequestResponse } from '@obiter/contracts'
import { confirmAccessRequestQueryOptions } from '../access-request'
import { AuthHeading, AuthLayout, authCardClassName } from './auth-layout'

function tokenFromSearch(search: { token?: unknown }): string {
  return typeof search.token === 'string' && search.token.length > 0
    ? search.token
    : ''
}

export function RequestAccessConfirmRouteView() {
  // SAFETY: useSearch with strict:false is untyped; token is re-validated as a non-empty string by tokenFromSearch before use.
  const search = useSearch({ strict: false }) as { token?: string }
  const token = tokenFromSearch(search)
  const confirmation = useQuery(confirmAccessRequestQueryOptions(token))

  return (
    <AuthLayout footnote="Need help? Contact your firm administrator.">
      {token.length === 0 ? (
        <Outcome
          icon={<Warning size={20} aria-hidden />}
          tone="danger"
          title="This link is not valid"
          body={invalidBody}
        >
          <RequestAgain />
        </Outcome>
      ) : confirmation.isPending ? (
        <AuthHeading
          title="Confirming your access"
          description="We are checking this link with the address you gave us."
        />
      ) : confirmation.isError ? (
        <Outcome
          icon={<Warning size={20} aria-hidden />}
          tone="danger"
          title="We could not check this link"
          body="The link has not been used. Check your connection and try again, or open the newest link from your email."
        >
          <Button onClick={() => void confirmation.refetch()}>Try again</Button>
          <RequestAgain />
        </Outcome>
      ) : (
        <ConfirmationOutcome outcome={confirmation.data} />
      )}
    </AuthLayout>
  )
}

const invalidBody =
  'Check that you opened the newest link from your email, or request access again.'

function ConfirmationOutcome({
  outcome,
}: {
  outcome: ConfirmAccessRequestResponse
}) {
  switch (outcome.status) {
    case 'verified':
      return outcome.next === 'sign_in' ? (
        <Outcome
          icon={<CheckCircle size={20} aria-hidden />}
          tone="success"
          title="You're verified"
          body="Your access to Obiter is confirmed. Sign in to start working."
        >
          <Link to="/sign-in" className={buttonClassName({ size: 'lg' })}>
            Continue to sign in
          </Link>
        </Outcome>
      ) : (
        <Outcome
          icon={<CheckCircle size={20} aria-hidden />}
          tone="success"
          title="You're verified"
          body="Your access is confirmed. The next step is to set your password and choose how you sign in; we have sent what you need to the address you gave us."
        >
          <Link
            to="/sign-in"
            className={buttonClassName({ variant: 'secondary' })}
          >
            Go to sign in
          </Link>
        </Outcome>
      )
    case 'pending_review':
      return (
        <Outcome
          icon={<Clock size={20} aria-hidden />}
          tone="info"
          title="We're confirming your organisation"
          body="Thanks. We check each new organisation once, usually within one working day, and we will email you when yours is done."
        />
      )
    case 'expired':
      return (
        <Outcome
          icon={<Clock size={20} aria-hidden />}
          tone="warning"
          title="This link has expired"
          body="Links stop working after a while. Enter your details again and we will send a new one."
        >
          <RequestAgain label="Request a new link" variant="primary" />
        </Outcome>
      )
    case 'invalid':
      return (
        <Outcome
          icon={<Warning size={20} aria-hidden />}
          tone="danger"
          title="This link is not valid"
          body={invalidBody}
        >
          <RequestAgain />
        </Outcome>
      )
  }
}

const OUTCOME_TONE = {
  success: 'bg-success-soft text-success',
  info: 'bg-info-soft text-info',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
} as const

function Outcome({
  icon,
  tone,
  title,
  body,
  children,
}: {
  icon: ReactNode
  tone: keyof typeof OUTCOME_TONE
  title: string
  body: string
  children?: ReactNode
}) {
  return (
    <div
      className={cn(
        authCardClassName,
        'mt-0 flex flex-col items-center gap-3 text-center',
      )}
    >
      <span
        className={cn(
          'grid size-10 place-items-center rounded-lg',
          OUTCOME_TONE[tone],
        )}
      >
        {icon}
      </span>
      <h1 className="text-page text-ink">{title}</h1>
      <p className="max-w-[42ch] text-body text-muted">{body}</p>
      {children}
    </div>
  )
}

function RequestAgain({
  label = 'Request access',
  variant = 'secondary',
}: {
  label?: string
  variant?: 'primary' | 'secondary'
}) {
  return (
    <Link to="/request-access" className={buttonClassName({ variant })}>
      {label}
    </Link>
  )
}
