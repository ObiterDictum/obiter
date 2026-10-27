import { Link } from '@tanstack/react-router'
import { Button, Input } from '@obiter/ui'
import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import {
  AuthDone,
  AuthFoot,
  AuthForm,
  AuthHeading,
  AuthLayout,
} from './auth-layout'

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
    <AuthLayout footnote="Changing your password signs out every other device.">
      {submitted ? (
        <AuthDone title="Check your email">
          <p className="max-w-[42ch] text-body text-muted">
            If an account exists for that email, we have sent a link to reset
            your password.
          </p>
          <Button
            variant="secondary"
            nativeButton={false}
            render={<Link to="/sign-in" />}
            className="mt-2"
          >
            Back to sign in
          </Button>
        </AuthDone>
      ) : (
        <>
          <AuthHeading
            title="Reset your password"
            description="Enter your work email. If an account exists, we will send a link to reset the password."
          />

          <AuthForm onSubmit={handleSubmit}>
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              required
              className="h-control-large"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={error ?? undefined}
            />
            <Button
              type="submit"
              size="lg"
              loading={submitting}
              className="mt-1 w-full"
            >
              Send reset link
            </Button>
          </AuthForm>
        </>
      )}

      {submitted ? null : (
        <AuthFoot>
          Remembered it?{' '}
          <Link to="/sign-in" className="text-ink hover:text-brand">
            Back to sign in
          </Link>
        </AuthFoot>
      )}
    </AuthLayout>
  )
}
