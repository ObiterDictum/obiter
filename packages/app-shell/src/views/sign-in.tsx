import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { Button, Input } from '@obiter/ui'
import { CheckCircle } from '@obiter/ui/icons'
import type { AppPlatform } from '@obiter/contracts'
import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { inviteAcceptCallbackURL } from '../invite-accept-callback-url'
import { SegmentedControl } from '../segmented-control'
import { AuthForm, AuthFoot, AuthHeading, AuthLayout } from './auth-layout'

type Mode = 'password' | 'magic-link'

const MODES = [
  { value: 'password' as const, label: 'Password' },
  { value: 'magic-link' as const, label: 'Email link' },
]

export function SignInRouteView({
  platform: _platform,
}: {
  platform: AppPlatform
}) {
  const navigate = useNavigate()
  const { signInWithEmail, requestMagicLink, resendVerificationEmail } =
    useAuth()
  // SAFETY: useSearch with strict:false is untyped; token is typeof-narrowed into inviteToken below and reset is compared against a literal.
  const search = useSearch({ strict: false }) as {
    reset?: string
    token?: string
  }
  const inviteToken =
    typeof search.token === 'string' && search.token.length > 0
      ? search.token
      : ''
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(
    search.reset === 'success'
      ? 'Your password has been reset. Sign in with your new password.'
      : null,
  )
  const [submitting, setSubmitting] = useState(false)
  const [unverified, setUnverified] = useState(false)

  async function goToHome() {
    if (inviteToken) {
      await navigate({
        to: '/invites/accept',
        search: { token: inviteToken },
      })
      return
    }
    await navigate({ to: '/' })
  }

  async function handlePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setUnverified(false)
    setSubmitting(true)
    try {
      const result = await signInWithEmail({ email, password })
      if (!result.ok) {
        setError(result.message ?? 'Sign-in failed.')
        setUnverified(result.code === 'EMAIL_NOT_VERIFIED')
        return
      }
      await goToHome()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign-in failed.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)
    try {
      const result = await requestMagicLink(
        email,
        inviteAcceptCallbackURL(inviteToken),
      )
      if (!result.ok) {
        setError(result.message ?? 'Could not send magic link.')
        return
      }
      setNotice(result.message ?? 'Check your email for a sign-in link.')
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not send magic link.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = mode === 'password' ? handlePassword : handleMagicLink

  return (
    <AuthLayout footnote="Need help? Contact your firm administrator.">
      <AuthHeading
        title="Sign in"
        description="Continue to your firm's Obiter workspace."
      />

      {notice && mode === 'password' ? (
        <p
          role="status"
          className="mt-6 flex items-start gap-2 rounded-md bg-success-soft px-4 py-3 text-meta text-ink"
        >
          <CheckCircle size={16} aria-hidden className="mt-0.5 text-success" />
          {notice}
        </p>
      ) : null}

      <div className="mt-6">
        <SegmentedControl
          label="Sign-in method"
          value={mode}
          options={MODES}
          onChange={setMode}
        />
      </div>

      <AuthForm onSubmit={handleSubmit}>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          className="h-control-large"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={mode === 'magic-link' ? (error ?? undefined) : undefined}
        />

        {mode === 'password' ? (
          <>
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <label
                  htmlFor="sign-in-password"
                  className="text-meta text-ink"
                >
                  Password
                </label>
                <Link
                  to="/forgot-password"
                  className="text-caption text-muted hover:text-ink"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="sign-in-password"
                type="password"
                autoComplete="current-password"
                required
                className="h-control-large"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={error ?? undefined}
              />
            </div>
          </>
        ) : null}

        {mode === 'magic-link' && error ? (
          <p className="text-meta text-danger">{error}</p>
        ) : null}
        {unverified ? (
          <ResendVerificationControl
            email={email}
            callbackURL={inviteAcceptCallbackURL(inviteToken)}
            resendVerificationEmail={resendVerificationEmail}
          />
        ) : null}

        <Button
          type="submit"
          size="lg"
          loading={submitting}
          className="mt-1 w-full"
        >
          {mode === 'password' ? 'Sign in' : 'Send sign-in link'}
        </Button>
      </AuthForm>

      <AuthFoot>
        New to Obiter?{' '}
        <Link
          to="/sign-up"
          search={inviteToken ? { token: inviteToken } : undefined}
          className="text-ink hover:text-brand"
        >
          Create an account
        </Link>
      </AuthFoot>
    </AuthLayout>
  )
}

export function ResendVerificationControl({
  email,
  callbackURL,
  resendVerificationEmail,
}: {
  email: string
  callbackURL?: string
  resendVerificationEmail: (
    email: string,
    callbackURL?: string,
  ) => Promise<{
    ok: boolean
    message?: string
  }>
}) {
  const [status, setStatus] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function handleResend() {
    setSending(true)
    setStatus(null)
    try {
      const result = callbackURL
        ? await resendVerificationEmail(email, callbackURL)
        : await resendVerificationEmail(email)
      setStatus(
        result.message ??
          (result.ok
            ? 'Check your email for a verification link.'
            : 'Could not send a verification email.'),
      )
    } catch {
      setStatus('Could not send a verification email.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="secondary"
        loading={sending}
        onClick={() => void handleResend()}
        className="w-full"
      >
        Resend verification email
      </Button>
      {status ? <p className="text-meta text-muted">{status}</p> : null}
    </div>
  )
}
