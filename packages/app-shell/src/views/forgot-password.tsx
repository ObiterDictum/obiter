import { Link } from '@tanstack/react-router'
import { ArrowLeft } from '@phosphor-icons/react'
import { Button, Input } from '@obiter/ui'
import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { Wordmark } from '../wordmark'
import { useForceNightTheme } from './sign-in'

/**
 * Forgot-password request screen. Calls the better-auth reset request
 * endpoint, which never reveals whether the email exists.
 */
export function ForgotPasswordRouteView() {
  const { requestPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useForceNightTheme()

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
      setSubmitted(true)
    } catch {
      setError(
        'Could not send a reset link. Check your connection and try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 text-ink">
      <div className="flex w-full max-w-[28rem] flex-col gap-8">
        <header className="flex flex-col items-center gap-4 text-center">
          <Wordmark className="text-[1.35rem]" />
          <div className="flex flex-col gap-1.5">
            <h1 className="text-lg font-semibold tracking-tight text-ink">
              Reset your password
            </h1>
            <p className="text-sm text-muted">
              We will email a link if an account exists.
            </p>
          </div>
        </header>

        <div className="flex flex-col gap-5 rounded-[0.85rem] border border-line bg-surface p-6">
          {submitted ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm leading-relaxed text-muted">
                If an account exists for that email, we have sent a link to
                reset your password.
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
                error={error ?? undefined}
              />
              <Button type="submit" loading={submitting} className="w-full">
                Send reset link
              </Button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-subtle">
          <Link
            to="/sign-in"
            className="font-medium text-brand hover:text-brand-pressed"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
