import { Link, useSearch } from '@tanstack/react-router'
import { ArrowRight } from '@phosphor-icons/react'
import { Button, Input } from '@obiter/ui'
import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { Wordmark } from '../wordmark'
import { useForceNightTheme, ResendVerificationControl } from './sign-in'

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
  const { signUpWithEmail, resendVerificationEmail } = useAuth()
  const search = useSearch({ strict: false }) as { token?: string }
  const token = inviteTokenFromSearch(search)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useForceNightTheme()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Name is required.')
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
      const result = await signUpWithEmail({
        name: trimmedName,
        email: email.trim(),
        password,
        ...(token
          ? {
              callbackURL: `${window.location.origin}/invites/accept?token=${encodeURIComponent(token)}`,
            }
          : {}),
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
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 text-ink">
      <div className="flex w-full max-w-[28rem] flex-col gap-8">
        <header className="flex flex-col items-center gap-4 text-center">
          <Wordmark className="text-[1.35rem]" />
          <div className="flex flex-col gap-1.5">
            <h1 className="text-lg font-semibold tracking-tight text-ink">
              Create an Obiter account
            </h1>
            <p className="text-sm text-muted">
              We will email a link to verify your address before you can sign
              in.
            </p>
          </div>
        </header>

        <div className="flex flex-col gap-5 rounded-[0.85rem] border border-line bg-surface p-6">
          {submitted ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm leading-relaxed text-muted">
                Check your email to verify your account before signing in.
              </p>
              <ResendVerificationControl
                email={email.trim()}
                resendVerificationEmail={resendVerificationEmail}
              />
              <Link
                to="/sign-in"
                search={signInSearch}
                className="text-sm font-medium text-brand hover:text-brand-pressed"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-4"
              noValidate
            >
              <Input
                label="Name"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Input
                label="Email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Input
                label="Password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={error ?? undefined}
              />
              <Button
                type="submit"
                loading={submitting}
                iconEnd={<ArrowRight size={16} weight="bold" />}
                className="w-full"
              >
                Create account
              </Button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-subtle">
          Already have an account?{' '}
          <Link
            to="/sign-in"
            search={signInSearch}
            className="font-medium text-brand hover:text-brand-pressed"
          >
            Sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
