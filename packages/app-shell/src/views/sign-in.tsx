import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { ArrowRight } from '@phosphor-icons/react'
import { Button, Input } from '@obiter/ui'
import type { AppPlatform } from '@obiter/contracts'
import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { THEME_STORAGE_KEY } from '../use-app-theme'
import { Wordmark } from '../wordmark'

type Mode = 'password' | 'magic-link'

/**
 * Sign-in against the auth API (better-auth email/password + magic link).
 * Account creation lives on /sign-up. The frame renders this route bare; on
 * success the user is sent to Home. Auth always forces the night aesthetic so
 * the entry gate matches product chrome.
 */
export function SignInRouteView({
  platform: _platform,
}: {
  platform: AppPlatform
}) {
  const navigate = useNavigate()
  const { signInWithEmail, requestMagicLink, resendVerificationEmail } =
    useAuth()
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

  useForceNightTheme()

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
      const result = await requestMagicLink(email)
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
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 text-ink">
      <div className="flex w-full max-w-[28rem] flex-col gap-8">
        <header className="flex flex-col items-center gap-4 text-center">
          <Wordmark className="text-[1.35rem]" />
          <div className="flex flex-col gap-1.5">
            <h1 className="text-lg font-semibold tracking-tight text-ink">
              Sign in to Obiter
            </h1>
            <p className="text-sm text-muted">
              Legal infrastructure for evidence-first work.
            </p>
          </div>
        </header>

        <div className="flex flex-col gap-5 rounded-[0.85rem] border border-line bg-surface p-6">
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-4"
            noValidate
          >
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            {mode === 'password' ? (
              <Input
                label="Password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={error ?? undefined}
              />
            ) : null}

            {mode === 'password' ? (
              <div className="flex justify-end">
                <Link
                  to="/forgot-password"
                  className="text-xs font-medium text-brand hover:text-brand-pressed"
                >
                  Forgot password?
                </Link>
              </div>
            ) : null}

            {mode === 'magic-link' && error ? (
              <p className="text-sm text-danger">{error}</p>
            ) : null}
            {notice ? <p className="text-sm text-muted">{notice}</p> : null}
            {unverified ? (
              <ResendVerificationControl
                email={email}
                resendVerificationEmail={resendVerificationEmail}
              />
            ) : null}

            <Button
              type="submit"
              loading={submitting}
              iconEnd={<ArrowRight size={16} weight="bold" />}
              className="w-full"
            >
              {mode === 'password' ? 'Continue' : 'Send sign-in link'}
            </Button>
          </form>

          <div className="flex items-center justify-center gap-1 text-sm text-muted">
            <ModeButton
              active={mode === 'password'}
              onClick={() => setMode('password')}
            >
              Password
            </ModeButton>
            <span aria-hidden="true" className="text-subtle">
              ·
            </span>
            <ModeButton
              active={mode === 'magic-link'}
              onClick={() => setMode('magic-link')}
            >
              Magic link
            </ModeButton>
          </div>
        </div>

        <p className="text-center text-xs text-subtle">
          Need an account?{' '}
          <Link
            to="/sign-up"
            search={inviteToken ? { token: inviteToken } : undefined}
            className="font-medium text-brand hover:text-brand-pressed"
          >
            Create one
          </Link>
          .
        </p>
      </div>
    </main>
  )
}

export function ResendVerificationControl({
  email,
  resendVerificationEmail,
}: {
  email: string
  resendVerificationEmail: (email: string) => Promise<{
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
      const result = await resendVerificationEmail(email)
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
      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  )
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'rounded-md px-2.5 py-1 transition-[color,background-color] duration-200 ' +
        (active
          ? 'bg-raised font-medium text-ink'
          : 'text-muted hover:text-ink')
      }
    >
      {children}
    </button>
  )
}

/** Auth routes always present night chrome regardless of persisted preference. */
export function useForceNightTheme() {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark')
    return () => {
      // After auth, restore an explicit light preference only; otherwise stay night.
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
      document.documentElement.setAttribute(
        'data-theme',
        stored === 'light' ? 'light' : 'dark',
      )
    }
  }, [])
}
