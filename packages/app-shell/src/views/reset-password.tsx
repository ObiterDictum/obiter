import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { Button, Input } from '@obiter/ui'
import { useState, type FormEvent } from 'react'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@obiter/contracts'
import { useAuth } from '../auth'
import { AuthFoot, AuthForm, AuthHeading, AuthLayout } from './auth-layout'

/**
 * Reset-password screen. The reset email links here with ?token=.
 */
export function ResetPasswordRouteView() {
  const navigate = useNavigate()
  const { resetPassword } = useAuth()
  // SAFETY: useSearch with strict:false is untyped; token and error are typeof-narrowed at each use below.
  const search = useSearch({ strict: false }) as {
    token?: string
    error?: string
  }
  const token = typeof search.token === 'string' ? search.token : ''
  const [tokenFailed, setTokenFailed] = useState(
    search.error === 'INVALID_TOKEN' || !token,
  )

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const TOKEN_DEAD_CODES = new Set(['INVALID_TOKEN', 'TOKEN_EXPIRED'])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setError(null)
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      setError(`Password must be at most ${MAX_PASSWORD_LENGTH} characters.`)
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
          setTokenFailed(true)
        } else {
          setError(result.message ?? 'Could not reset your password.')
        }
        return
      }
      await navigate({ to: '/sign-in', search: { reset: 'success' } })
    } catch {
      setError(
        'Could not reset your password. Check your connection and try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout footnote="Reset links are single use and expire after 30 minutes.">
      {tokenFailed ? (
        <>
          <AuthHeading
            title="This link has expired"
            description={
              <>
                <span className="block">
                  This reset link is invalid or has expired.
                </span>
                <span className="block">Request a new one to continue.</span>
              </>
            }
          />
          <div className="mt-6 flex flex-col gap-2">
            <Button
              size="lg"
              nativeButton={false}
              render={<Link to="/forgot-password" />}
              className="w-full"
            >
              Request a new reset link
            </Button>
            <Button
              variant="ghost"
              size="lg"
              nativeButton={false}
              render={<Link to="/sign-in" />}
              className="w-full"
            >
              Back to sign in
            </Button>
          </div>
        </>
      ) : (
        <>
          <AuthHeading
            title="Set a new password"
            description="Choose a password for your account."
          />

          <AuthForm onSubmit={handleSubmit}>
            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              className="h-control-large"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              helperText={`At least ${MIN_PASSWORD_LENGTH} characters.`}
              error={error ?? undefined}
            />
            <Input
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              className="h-control-large"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <Button
              type="submit"
              size="lg"
              loading={submitting}
              className="mt-1 w-full"
            >
              Reset password
            </Button>
          </AuthForm>
        </>
      )}

      {tokenFailed ? null : (
        <AuthFoot>
          <Link to="/sign-in" className="text-ink hover:text-brand">
            Back to sign in
          </Link>
        </AuthFoot>
      )}
    </AuthLayout>
  )
}
