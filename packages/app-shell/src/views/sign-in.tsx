import { useNavigate } from '@tanstack/react-router'
import { ArrowRight } from '@phosphor-icons/react'
import { Button, Card, Input } from '@ormont/ui'
import type { AppPlatform } from '@ormont/contracts'
import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import wordmarkUrl from '../assets/obiter-wordmark.svg'

type Mode = 'password' | 'magic-link'

/**
 * Real sign-in against the auth API (better-auth email/password + magic link).
 * Replaces the cosmetic Phase 0 sign-in. The frame renders this route bare
 * (no sidebar); on success the user is sent to /workspace.
 */
export function SignInRouteView({ platform: _platform }: { platform: AppPlatform }) {
  const navigate = useNavigate()
  const { signInWithEmail, requestMagicLink } = useAuth()
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handlePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)
    const result = await signInWithEmail({ email, password })
    setSubmitting(false)
    if (!result.ok) {
      setError(result.message ?? 'Sign-in failed.')
      return
    }
    void navigate({ to: '/workspace' })
  }

  async function handleMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)
    const result = await requestMagicLink(email)
    setSubmitting(false)
    if (!result.ok) {
      setError(result.message ?? 'Could not send magic link.')
      return
    }
    setNotice(result.message ?? 'Check your email for a sign-in link.')
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 text-ink">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <header className="flex flex-col items-center gap-3 text-center">
          <img src={wordmarkUrl} alt="Obiter" className="h-12 w-auto text-ink" />
          <h1 className="text-xl font-semibold tracking-tight">Sign in to Obiter</h1>
        </header>

        <Card>
          <div className="flex flex-col gap-4">
            <form
              onSubmit={mode === 'password' ? handlePassword : handleMagicLink}
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

              {mode === 'magic-link' && error ? (
                <p className="text-sm text-danger">{error}</p>
              ) : null}
              {notice ? <p className="text-sm text-muted">{notice}</p> : null}

              <Button
                type="submit"
                loading={submitting}
                iconEnd={<ArrowRight size={16} weight="bold" />}
                className="w-full"
              >
                {mode === 'password' ? 'Continue' : 'Send sign-in link'}
              </Button>
            </form>

            <div className="flex items-center justify-center gap-2 text-sm text-muted">
              <ModeButton active={mode === 'password'} onClick={() => setMode('password')}>
                Password
              </ModeButton>
              <span aria-hidden="true">·</span>
              <ModeButton active={mode === 'magic-link'} onClick={() => setMode('magic-link')}>
                Magic link
              </ModeButton>
            </div>
          </div>
        </Card>

        <p className="text-center text-xs text-subtle">
          Sign-in is disabled for new accounts. Ask your firm administrator for credentials.
        </p>
      </div>
    </main>
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
        'rounded-pill px-3 py-1 transition-colors ' +
        (active ? 'bg-surface text-ink' : 'text-muted hover:text-ink')
      }
    >
      {children}
    </button>
  )
}
