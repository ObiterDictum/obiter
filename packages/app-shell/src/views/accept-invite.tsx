import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { Button } from '@obiter/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, apiFetch } from '../api'
import { useAuth } from '../auth'
import { inviteAcceptCallbackURL } from '../invite-accept-callback-url'
import { Wordmark } from '../wordmark'
import { ResendVerificationControl, useForceNightTheme } from './sign-in'

function inviteTokenFromSearch(search: { token?: unknown }): string {
  return typeof search.token === 'string' && search.token.length > 0
    ? search.token
    : ''
}

/**
 * Landing page for organisation invite emails. Signed-out users are sent to
 * sign-up with the token preserved; signed-in users POST /api/invites/accept.
 */
export function AcceptInviteRouteView() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { session, isPending, resendVerificationEmail } = useAuth()
  const search = useSearch({ strict: false }) as { token?: string }
  const token = inviteTokenFromSearch(search)
  const [error, setError] = useState<AcceptFailure | null>(
    token ? null : { kind: 'missing_token' },
  )
  const [submitting, setSubmitting] = useState(false)

  useForceNightTheme()

  async function handleAccept() {
    if (!token) {
      setError({ kind: 'missing_token' })
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await apiFetch('/api/invites/accept', {
        method: 'POST',
        body: JSON.stringify({ token }),
      })
      await queryClient.invalidateQueries({ queryKey: ['current-user'] })
      await navigate({ to: '/' })
    } catch (caught) {
      setError(classifyAcceptFailure(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 text-ink">
      <div className="flex w-full max-w-[28rem] flex-col gap-8">
        <header className="flex flex-col items-center gap-4 text-center">
          <Wordmark className="text-[1.35rem]" />
          <div className="flex flex-col gap-1.5">
            <h1 className="text-lg font-semibold tracking-tight text-ink">
              Accept organisation invite
            </h1>
            <p className="text-sm text-muted">
              Join the organisation this invite was sent for.
            </p>
          </div>
        </header>

        <div className="flex flex-col gap-5 rounded-[0.85rem] border border-line bg-surface p-6">
          {isPending ? (
            <p className="text-sm text-muted">Checking your session…</p>
          ) : !session ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm leading-relaxed text-muted">
                You need an Obiter account to accept this invite. Create one
                with the same email the invite was sent to, then return here.
              </p>
              {token ? (
                <Link
                  to="/sign-up"
                  search={{ token }}
                  className="text-sm font-medium text-brand hover:text-brand-pressed"
                >
                  Create an account
                </Link>
              ) : (
                <p className="text-sm text-danger">
                  This invite link is missing a token.
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {error ? <AcceptFailureMessage failure={error} /> : null}
              {error?.kind === 'unverified' && session.user.email ? (
                <ResendVerificationControl
                  email={session.user.email}
                  callbackURL={inviteAcceptCallbackURL(token)}
                  resendVerificationEmail={resendVerificationEmail}
                />
              ) : null}
              {error?.kind === 'missing_token' ? null : (
                <Button
                  type="button"
                  loading={submitting}
                  onClick={() => void handleAccept()}
                  className="w-full"
                >
                  Accept invite
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

type AcceptFailure =
  | { kind: 'missing_token' }
  | { kind: 'not_empty'; message: string }
  | { kind: 'no_longer_valid' }
  | { kind: 'wrong_email' }
  | { kind: 'unverified' }
  | { kind: 'already_member' }
  | { kind: 'other'; message: string }

function classifyAcceptFailure(caught: unknown): AcceptFailure {
  if (!(caught instanceof ApiError)) {
    return {
      kind: 'other',
      message:
        caught instanceof Error
          ? caught.message
          : 'Could not accept this invite.',
    }
  }
  if (caught.code === 'organisation_not_empty') {
    return { kind: 'not_empty', message: caught.message }
  }
  if (caught.code === 'invite_not_found') {
    return { kind: 'no_longer_valid' }
  }
  if (caught.code === 'conflict_detected') {
    return { kind: 'already_member' }
  }
  if (caught.code === 'forbidden') {
    if (/different email/i.test(caught.message)) {
      return { kind: 'wrong_email' }
    }
    if (/verify your email/i.test(caught.message)) {
      return { kind: 'unverified' }
    }
  }
  return { kind: 'other', message: caught.message }
}

function AcceptFailureMessage({ failure }: { failure: AcceptFailure }) {
  switch (failure.kind) {
    case 'missing_token':
      return (
        <p className="text-sm text-danger">
          This invite link is missing a token.
        </p>
      )
    case 'not_empty':
      return (
        <div className="flex flex-col gap-2 text-sm text-danger">
          <p>{failure.message}</p>
          <p>
            Revoke your own pending invites first, then try this invite again.
          </p>
        </div>
      )
    case 'no_longer_valid':
      return (
        <p className="text-sm text-danger">
          This invite has expired, been revoked, or has already been accepted.
        </p>
      )
    case 'wrong_email':
      return (
        <p className="text-sm text-danger">
          This invite was sent to a different email address. Sign in with the
          address the invite was sent to.
        </p>
      )
    case 'unverified':
      return (
        <p className="text-sm text-danger">
          Verify your email before accepting an invite.
        </p>
      )
    case 'already_member':
      return (
        <p className="text-sm text-danger">
          You already belong to this organisation.
        </p>
      )
    case 'other':
      return <p className="text-sm text-danger">{failure.message}</p>
  }
}
