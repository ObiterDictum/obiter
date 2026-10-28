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
import { ResendVerificationControl } from './sign-in'
import { AuthHeading, AuthLayout } from './auth-layout'

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
  // SAFETY: useSearch with strict:false is untyped; token is re-validated as a non-empty string by inviteTokenFromSearch before use.
  const search = useSearch({ strict: false }) as { token?: string }
  const token = inviteTokenFromSearch(search)
  const previewQuery = useQuery({
    ...invitePreviewQueryOptions(token),
    enabled: token.length > 0,
  })
  const [error, setError] = useState<AcceptFailure | null>(null)
  const [submitting, setSubmitting] = useState(false)

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
    <AuthLayout footnote="Invitations can be accepted once and expire after 7 days.">
      <AuthHeading
        title="Accept organisation invite"
        description={<InviteHeading preview={preview} />}
      />

      <div className="mt-6 flex flex-col gap-4">
        {checking ? (
          <p className="text-meta text-muted">Checking this invite…</p>
        ) : pageFailure ? (
          <AcceptFailureMessage failure={pageFailure} />
        ) : previewQuery.isError ? (
          <p className="text-meta text-danger">
            Could not load this invite. Try the link again.
          </p>
        ) : showSignUp ? (
          <>
            <p className="text-body text-muted">
              You need an Obiter account to accept this invite. Create one with
              the same email the invite was sent to.
            </p>
            <Button
              size="lg"
              nativeButton={false}
              render={<Link to="/sign-up" search={{ token }} />}
              className="w-full"
            >
              Create an account
            </Button>
            <p className="text-center text-caption text-subtle">
              Already have an account?{' '}
              <Link
                to="/sign-in"
                search={{ token }}
                className="text-ink hover:text-brand"
              >
                Sign in
              </Link>
            </p>
          </>
        ) : (
          <>
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
                size="lg"
                loading={submitting}
                onClick={() => void handleAccept()}
                className="w-full"
              >
                Accept invite
              </Button>
            ) : null}
          </>
        )}
      </div>
    </AuthLayout>
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
        <span className="block">Join {preview.organisationName}.</span>
        <span className="block">
          {preview.invitedByName} invited you to join this organisation.
        </span>
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
        <p className="text-meta text-danger">
          This invite link is missing a token.
        </p>
      )
    case 'not_empty':
      return (
        <div className="flex flex-col gap-2 text-meta text-danger">
          <p>{failure.message}</p>
          <p>
            Revoke your own pending invites first, then try this invite again.
          </p>
        </div>
      )
    case 'invite_not_found':
      return (
        <p className="text-meta text-danger">
          This invite was not found. Check the link from your email.
        </p>
      )
    case 'invite_expired':
      return (
        <p className="text-meta text-danger">
          This invite has expired. Ask the organisation to send a new one.
        </p>
      )
    case 'invite_revoked':
      return (
        <p className="text-meta text-danger">
          This invite has been revoked. Ask the organisation to send a new one.
        </p>
      )
    case 'invite_already_accepted':
      return (
        <p className="text-meta text-danger">
          This invite has already been accepted.
        </p>
      )
    case 'wrong_email':
      return (
        <p className="text-meta text-danger">
          This invite was sent to a different email address. Sign in with the
          address the invite was sent to.
        </p>
      )
    case 'unverified':
      return (
        <p className="text-meta text-danger">
          Verify your email before accepting an invite.
        </p>
      )
    case 'already_member':
      return (
        <p className="text-meta text-danger">
          You already belong to this organisation.
        </p>
      )
    case 'other':
      return <p className="text-meta text-danger">{failure.message}</p>
  }
}
