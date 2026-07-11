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
 * this screen, the token is validated on submit.
 *
 * Only a true token failure (better-auth INVALID_TOKEN / TOKEN_EXPIRED — the
 * token is absent, expired, or already consumed) flips to the dedicated
 * "request a new link" state. Other failures (PASSWORD_TOO_LONG, a 5xx, a
 * network blip) render an inline error so the user can retry with the same
 * valid token instead of losing the form. On success the user is sent to
 * /sign-in to sign in with the new password.
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

  // better-auth error codes that mean the token is dead (absent, expired, or
  // already used) — see @better-auth/core BASE_ERROR_CODES. Anything else is a
  // retryable failure and stays on the form.
  const TOKEN_DEAD_CODES = new Set(['INVALID_TOKEN', 'TOKEN_EXPIRED'])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // In-flight guard: a rapid double-submit (e.g. Enter while pending) would
    // race the second call against the first and could consume the token then
    // surface a spurious token failure.
    if (submitting) return
    setError(null)
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password.length > 128) {
      setError('Password must be at most 128 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setSubmitting(true)
    try {
      const result = await resetPassword(token, password)
      if (!result.ok) {
        if (result.code && TOKEN_DEAD_CODES.has(result.code)) {
          // The token is genuinely invalid/expired/used — the only recovery
          // is a new reset link.
          setTokenFailed(true)
        } else {
          // Validation/server/network failure: keep the form so the user can
          // retry with the same (still-valid) token.
          setError(result.message ?? 'Could not reset your password.')
        }
        return
      }
      await navigate({ to: '/sign-in', search: { reset: 'success' } })
    } catch {
      // resetPassword is expected to map errors into { ok: false }; a throw
      // here is a network-level failure — keep the form, surface a message.
      setError('Could not reset your password. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
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
                maxLength={128}
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
                maxLength={128}
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
