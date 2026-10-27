import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { Button, Input } from '@obiter/ui'
import { useState, type FormEvent } from 'react'
import { ORGANISATION_NAME_MAX_LENGTH } from '@obiter/contracts'
import { useAuth } from '../auth'
import { inviteAcceptCallbackURL } from '../invite-accept-callback-url'
import { checkInviteAccountExists } from '../organisation-membership'
import {
  AuthDone,
  AuthFoot,
  AuthForm,
  AuthHeading,
  AuthLayout,
} from './auth-layout'
import { ResendVerificationControl } from './sign-in'

function inviteTokenFromSearch(search: { token?: unknown }): string {
  return typeof search.token === 'string' && search.token.length > 0
    ? search.token
    : ''
}

/**
 * Self-serve registration. Verification is required, so success ends on a
 * check-your-email state rather than a session.
 */
export function SignUpRouteView() {
  const navigate = useNavigate()
  const { signUpWithEmail, resendVerificationEmail } = useAuth()
  // SAFETY: useSearch with strict:false is untyped; token is re-validated as a non-empty string by inviteTokenFromSearch before use.
  const search = useSearch({ strict: false }) as { token?: string }
  const token = inviteTokenFromSearch(search)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [organisationName, setOrganisationName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Name is required.')
      return
    }
    // Invitees join the inviting organisation, so they never name one.
    // Everyone else names their new workspace here — this is the only
    // moment the name can be captured before product surfaces
    // auto-provision a default-named workspace.
    const trimmedOrgName = token ? '' : organisationName.trim()
    if (!token && !trimmedOrgName) {
      setError('Organisation name is required.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password.length > 128) {
      setError('Password must be at most 128 characters.')
      return
    }
    setSubmitting(true)
    try {
      const trimmedEmail = email.trim()
      // An invitee who already registered should sign in — better-auth's
      // duplicate sign-up response is indistinguishable from a fresh one
      // ("check your email" with no email actually sent). Undetermined →
      // proceed with normal sign-up rather than blocking.
      if (
        token &&
        (await checkInviteAccountExists(token, trimmedEmail)) === true
      ) {
        await navigate({ to: '/sign-in', search: { token } })
        return
      }
      const result = await signUpWithEmail({
        name: trimmedName,
        email: trimmedEmail,
        password,
        ...(token ? { callbackURL: inviteAcceptCallbackURL(token) } : {}),
        ...(trimmedOrgName ? { pendingOrganisationName: trimmedOrgName } : {}),
      })
      if (!result.ok) {
        setError(result.message ?? 'Sign-up failed.')
        return
      }
      setSubmitted(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign-up failed.')
    } finally {
      setSubmitting(false)
    }
  }

  const signInSearch = token ? { token } : undefined

  return (
    <AuthLayout footnote="Need help? Contact your firm administrator.">
      {submitted ? (
        <AuthDone title="Check your email">
          <p className="max-w-[42ch] text-body text-muted">
            Check your email to verify your account before signing in.
          </p>
          <div className="flex w-full flex-col gap-2">
            <ResendVerificationControl
              email={email.trim()}
              callbackURL={inviteAcceptCallbackURL(token)}
              resendVerificationEmail={resendVerificationEmail}
            />
            <Button
              variant="ghost"
              nativeButton={false}
              render={<Link to="/sign-in" search={signInSearch} />}
            >
              Back to sign in
            </Button>
          </div>
        </AuthDone>
      ) : (
        <>
          <AuthHeading
            title="Create an account"
            description="Start with your details. We will email a link to verify your address."
          />

          <AuthForm onSubmit={handleSubmit}>
            <Input
              label="Name"
              type="text"
              autoComplete="name"
              required
              className="h-control-large"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              required
              className="h-control-large"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {!token ? (
              <Input
                label="Organisation name"
                type="text"
                autoComplete="organization"
                required
                maxLength={ORGANISATION_NAME_MAX_LENGTH}
                className="h-control-large"
                value={organisationName}
                onChange={(e) => setOrganisationName(e.target.value)}
                helperText="Your firm or chambers. You can invite colleagues later."
              />
            ) : null}
            <Input
              label="Password"
              type="password"
              autoComplete="new-password"
              required
              className="h-control-large"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              helperText="At least 8 characters."
              error={error ?? undefined}
            />
            <Button
              type="submit"
              size="lg"
              loading={submitting}
              className="mt-1 w-full"
            >
              Create account
            </Button>
          </AuthForm>
        </>
      )}

      {submitted ? null : (
        <AuthFoot>
          Already have an account?{' '}
          <Link
            to="/sign-in"
            search={signInSearch}
            className="text-ink hover:text-brand"
          >
            Sign in
          </Link>
        </AuthFoot>
      )}
    </AuthLayout>
  )
}
