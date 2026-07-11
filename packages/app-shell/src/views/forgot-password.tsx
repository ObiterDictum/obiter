import { Link } from '@tanstack/react-router'
import { ArrowLeft } from '@phosphor-icons/react'
import { Button, Card, Input } from '@obiter/ui'
import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { Wordmark } from '../wordmark'

/**
 * Forgot-password request screen. Calls the better-auth reset request
 * endpoint, which never reveals whether the email exists (it returns the same
 * message for known and unknown addresses and runs a timing-attack
 * mitigation). The confirmation state is shown regardless of outcome.
 */
export function ForgotPasswordRouteView() {
  const { requestPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const result = await requestPasswordReset(email.trim())
      if (!result.ok) {
        setError(result.message ?? 'Could not send a reset link.')
        return
      }
      // Always reach the confirmation state — the request endpoint deliberately
      // does not reveal whether the account exists.
      setSubmitted(true)
    } catch {
      setError('Could not send a reset link. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 text-ink">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <header className="flex flex-col items-center gap-3 text-center">
          <Wordmark className="h-12 w-auto" />
          <h1 className="text-xl font-semibold tracking-tight">Reset your password</h1>
        </header>

        <Card>
          {submitted ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm leading-relaxed text-muted">
                If an account exists for that email, we have sent a link to reset your password.
              </p>
              <Link
                to="/sign-in"
                className="inline-flex items-center justify-center gap-1.5 text-sm font-medium text-brand hover:text-brand-pressed"
              >
                <ArrowLeft size={15} aria-hidden="true" />
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
              <Input
                label="Email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={error ?? undefined}
              />
              <Button
                type="submit"
                loading={submitting}
                iconEnd={<ArrowLeft size={16} weight="bold" />}
                className="w-full"
              >
                Send reset link
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
