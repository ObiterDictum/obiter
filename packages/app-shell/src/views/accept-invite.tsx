import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { Button } from '@obiter/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, apiFetch } from '../api'
import { useAuth } from '../auth'
import { inviteAcceptCallbackURL } from '../invite-accept-callback-url'
import {
  invitePreviewQueryOptions,
  type InvitePreviewResult,
} from '../organisation-membership'
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
 * Organisation and inviter names come from GET /api/invites/preview, loaded
 * in the route loader via ensureQueryData.
 */
export function AcceptInviteRouteView() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { session, isPending, resendVerificationEmail } = useAuth()
  const search = useSearch({ strict: false }) as { token?: string }
  const token = inviteTokenFromSearch(search)
  const previewQuery = useQuery({
    ...invitePreviewQueryOptions(token),
    enabled: token.length > 0,
  })
  const [error, setError] = useState<AcceptFailure | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useForceNightTheme()

  const preview = previewQuery.data
  const previewFailure = previewFailureFromResult(preview)
  const tokenFailure: AcceptFailure | null = token
    ? null
    : { kind: 'missing_token' }
  const pageFailure = tokenFailure ?? previewFailure

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

  const checking = isPending || (token.length > 0 && previewQuery.isPending)
  const canJoin = Boolean(token) && preview?.ok === true
  const showAccept =
    Boolean(session) && canJoin && error?.kind !== 'missing_token'
  const showSignUp = !session && canJoin

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 text-ink">
      <div className="flex w-full max-w-[28rem] flex-col gap-8">
        <header className="flex flex-col items-center gap-4 text-center">
          <Wordmark className="text-[1.35rem]" />
          <div className="flex flex-col gap-1.5">
            <h1 className="text-lg font-semibold tracking-tight text-ink">
              Accept organisation invite
            </h1>
            <InviteHeading preview={preview} />
          </div>
        </header>

        <div className="flex flex-col gap-5 rounded-[0.85rem] border border-line bg-surface p-6">
          {checking ? (
            <p className="text-sm text-muted">Checking this invite…</p>
          ) : pageFailure ? (
            <AcceptFailureMessage failure={pageFailure} />
          ) : previewQuery.isError ? (
            <p className="text-sm text-danger">
              Could not load this invite. Try the link again.
            </p>
          ) : showSignUp ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm leading-relaxed text-muted">
                You need an Obiter account to accept this invite. Create one
                with the same email the invite was sent to, then return here.
              </p>
              <Link
                to="/sign-up"
                search={{ token }}
                className="text-sm font-medium text-brand hover:text-brand-pressed"
              >
                Create an account
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {error ? <AcceptFailureMessage failure={error} /> : null}
              {error?.kind === 'unverified' && session?.user.email ? (
                <ResendVerificationControl
                  email={session.user.email}
                  callbackURL={inviteAcceptCallbackURL(token)}
                  resendVerificationEmail={resendVerificationEmail}
                />
              ) : null}
              {showAccept ? (
                <Button
                  type="button"
                  loading={submitting}
                  onClick={() => void handleAccept()}
                  className="w-full"
                >
                  Accept invite
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

function InviteHeading({
  preview,
}: {
  preview: InvitePreviewResult | undefined
}) {
  if (preview?.ok) {
    return (
      <>
        <p className="text-sm text-muted">Join {preview.organisationName}.</p>
        <p className="text-sm text-muted">
          {preview.invitedByName} invited you to join this organisation.
        </p>
      </>
    )
  }
  return null
}

type AcceptFailure =
  | { kind: 'missing_token' }
  | { kind: 'not_empty'; message: string }
  | { kind: 'invite_not_found' }
  | { kind: 'invite_expired' }
  | { kind: 'invite_revoked' }
  | { kind: 'invite_already_accepted' }
  | { kind: 'wrong_email' }
  | { kind: 'unverified' }
  | { kind: 'already_member' }
  | { kind: 'other'; message: string }

function previewFailureFromResult(
  preview: InvitePreviewResult | undefined,
): AcceptFailure | null {
  if (!preview || preview.ok) return null
  return { kind: preview.code }
}

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
  if (
    caught.code === 'invite_not_found' ||
    caught.code === 'invite_expired' ||
    caught.code === 'invite_revoked' ||
    caught.code === 'invite_already_accepted'
  ) {
    return { kind: caught.code }
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
    case 'invite_not_found':
      return (
        <p className="text-sm text-danger">
          This invite was not found. Check the link from your email.
        </p>
      )
    case 'invite_expired':
      return (
        <p className="text-sm text-danger">
          This invite has expired. Ask the organisation to send a new one.
        </p>
      )
    case 'invite_revoked':
      return (
        <p className="text-sm text-danger">
          This invite has been revoked. Ask the organisation to send a new one.
        </p>
      )
    case 'invite_already_accepted':
      return (
        <p className="text-sm text-danger">
          This invite has already been accepted.
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
