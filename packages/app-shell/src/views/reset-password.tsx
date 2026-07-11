import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { ArrowRight } from '@phosphor-icons/react'
import { Button, Card, Input } from '@obiter/ui'
import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { Wordmark } from '../wordmark'

/**
 * Reset-password screen. The reset email links here with ?token= (the token is
 * derived server-side and always targets the web origin). Better-auth tokens
 * are single-use and expire (default 1h). Because the link points straight at
 * this screen, the token is validated on submit — an expired/already-used
 * token surfaces as a submit failure, which flips the screen to its
 * "request a new link" state rather than a generic inline error. On success
 * the user is sent to /sign-in to sign in with the new password.
 */
export function ResetPasswordRouteView() {
  const navigate = useNavigate()
  const { resetPassword } = useAuth()
  const search = useSearch({ strict: false }) as { token?: string; error?: string }
  const token = typeof search.token === 'string' ? search.token : ''
  // No token on the URL means the link was malformed; an explicit error is the
  // legacy pre-validation flag. Both start in the invalid-token state.
  const [tokenFailed, setTokenFailed] = useState(search.error === 'INVALID_TOKEN' || !token)

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setSubmitting(true)
    const result = await resetPassword(token, password)
    setSubmitting(false)
    if (!result.ok) {
      // The token may have expired or already been used. Since validation now
      // happens on submit (the email links straight here), surface the
      // dedicated "request a new link" state rather than a generic inline
      // error so the user has a clear next step.
      setTokenFailed(true)
      return
    }
    await navigate({ to: '/sign-in', search: { reset: 'success' } })
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 text-ink">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <header className="flex flex-col items-center gap-3 text-center">
          <Wordmark className="h-12 w-auto" />
          <h1 className="text-xl font-semibold tracking-tight">Set a new password</h1>
        </header>

        <Card>
          {tokenFailed ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm leading-relaxed text-muted">
                This reset link is invalid or has expired.
              </p>
              <Link
                to="/forgot-password"
                className="inline-flex items-center justify-center gap-1.5 text-sm font-medium text-brand hover:text-brand-pressed"
              >
                Request a new reset link
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
              <Input
                label="New password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={error ?? undefined}
              />
              <Input
                label="Confirm new password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <Button
                type="submit"
                loading={submitting}
                iconEnd={<ArrowRight size={16} weight="bold" />}
                className="w-full"
              >
                Reset password
              </Button>
            </form>
          )}
        </Card>

        <p className="text-center text-xs text-subtle">
          <Link to="/sign-in" className="font-medium text-brand hover:text-brand-pressed">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
