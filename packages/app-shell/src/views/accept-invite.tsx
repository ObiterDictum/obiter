import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { Button, buttonClassName } from '@obiter/ui'
import { Warning } from '@obiter/ui/icons'
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

export function AcceptInviteRouteView() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { session, isPending, resendVerificationEmail, signOut } = useAuth()
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
  const differentEmail =
    Boolean(session) &&
    preview?.ok === true &&
    preview.matchesSessionEmail === false
  const showAccept =
    Boolean(session) &&
    canJoin &&
    !differentEmail &&
    error?.kind !== 'missing_token'
  const showSignUp = !session && canJoin
  const failureNotice = error ?? (differentEmail ? wrongEmail : null)

  async function handleSignOut() {
    try {
      await signOut()
      await navigate({ to: '/sign-in', search: { token } })
    } catch (caught) {
      setError({
        kind: 'other',
        message:
          caught instanceof Error ? caught.message : 'Could not sign out.',
      })
    }
  }

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
          <InviteFailureNotice failure={pageFailure} token={token} />
        ) : previewQuery.isError ? (
          <InviteFailureNotice
            failure={{ kind: 'other', message: '' }}
            token={token}
          />
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
            {failureNotice ? (
              <InviteFailureNotice
                failure={failureNotice}
                token={token}
                onSignOut={
                  failureNotice.kind === 'wrong_email'
                    ? () => void handleSignOut()
                    : undefined
                }
              />
            ) : null}
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

const wrongEmail: AcceptFailure = { kind: 'wrong_email' }

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

interface FailureCopy {
  title: string
  body: string
  next?: string
  newInvite?: boolean
}

function failureCopy(failure: AcceptFailure): FailureCopy {
  switch (failure.kind) {
    case 'missing_token':
      return {
        title: 'This invite link is incomplete',
        body: 'The link is missing the token that identifies the invitation, so there is nothing here to accept.',
        newInvite: true,
      }
    case 'invite_not_found':
      return {
        title: 'We cannot find that invite',
        body: 'It may have been deleted or replaced, or the link in your email may be out of date.',
        newInvite: true,
      }
    case 'invite_expired':
      return {
        title: 'This invite has expired',
        body: 'Invitations can be accepted for seven days after they are sent.',
        newInvite: true,
      }
    case 'invite_revoked':
      return {
        title: 'This invite has been revoked',
        body: 'The organisation withdrew this invitation, so it can no longer be accepted.',
        newInvite: true,
      }
    case 'invite_already_accepted':
      return {
        title: 'This invite has already been accepted',
        body: 'An invite can only be used once, and this one has been used.',
        newInvite: true,
      }
    case 'wrong_email':
      return {
        title: 'This invite was sent to a different email address',
        body: 'Sign in with the address the invite was sent to.',
        newInvite: true,
      }
    case 'unverified':
      return {
        title: 'Verify your email before accepting',
        body: 'An invite can only be accepted by a verified address.',
      }
    case 'already_member':
      return {
        title: 'You already belong to this organisation',
        body: 'There is nothing to accept: your account is already a member.',
      }
    case 'not_empty':
      return {
        title: 'This invite cannot be accepted yet',
        body: failure.message,
        next: 'Revoke your own pending invites first, then open this link again.',
      }
    case 'other':
      return {
        title: 'The invite could not be accepted',
        body:
          failure.message ||
          'The invite could not be loaded. Open the link from your email again.',
      }
  }
}

function InviteFailureNotice({
  failure,
  token,
  onSignOut,
}: {
  failure: AcceptFailure
  token: string
  onSignOut?: () => void
}) {
  const copy = failureCopy(failure)
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-lg bg-danger-soft p-4"
    >
      <span
        aria-hidden
        className="grid size-8 place-items-center rounded-md bg-danger text-danger-fg"
      >
        <Warning size={16} />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-item text-ink">{copy.title}</p>
        <p className="text-meta text-muted">{copy.body}</p>
        {copy.next ? <p className="text-meta text-muted">{copy.next}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {onSignOut ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onSignOut}
          >
            Sign out and switch account
          </Button>
        ) : null}
        <Link
          to="/sign-in"
          search={token ? { token } : undefined}
          className={buttonClassName({ variant: 'secondary', size: 'sm' })}
        >
          Back to sign in
        </Link>
      </div>
      {copy.newInvite ? (
        <p className="text-caption text-subtle">
          Ask your administrator for a new invite.
        </p>
      ) : null}
    </div>
  )
}
