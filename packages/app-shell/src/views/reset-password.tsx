import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { ArrowRight } from '@phosphor-icons/react'
import { Button, Input } from '@obiter/ui'
import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { Wordmark } from '../wordmark'
import { useForceNightTheme } from './sign-in'

/**
 * Reset-password screen. The reset email links here with ?token=.
 */
export function ResetPasswordRouteView() {
  const navigate = useNavigate()
  const { resetPassword } = useAuth()
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

  useForceNightTheme()

  const TOKEN_DEAD_CODES = new Set(['INVALID_TOKEN', 'TOKEN_EXPIRED'])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
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
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 text-ink">
      <div className="flex w-full max-w-[28rem] flex-col gap-8">
        <header className="flex flex-col items-center gap-4 text-center">
          <Wordmark className="text-[1.35rem]" />
          <div className="flex flex-col gap-1.5">
            <h1 className="text-lg font-semibold tracking-tight text-ink">
              Set a new password
            </h1>
            <p className="text-sm text-muted">
              Choose a password for your account.
            </p>
          </div>
        </header>

        <div className="flex flex-col gap-5 rounded-[0.85rem] border border-line bg-surface p-6">
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
            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-4"
              noValidate
            >
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
