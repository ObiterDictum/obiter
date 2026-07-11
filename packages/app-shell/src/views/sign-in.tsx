import { useNavigate } from '@tanstack/react-router'
import { ArrowRight } from '@phosphor-icons/react'
import { Button, Card, Input } from '@obiter/ui'
import type { AppPlatform } from '@obiter/contracts'
import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { Wordmark } from '../wordmark'

type Mode = 'password' | 'magic-link' | 'register'

/**
 * Real sign-in / self-registration against the auth API (better-auth
 * email/password + magic link). The frame renders this route bare (no
 * sidebar); on success the user is sent to /workspace.
 */
export function SignInRouteView({ platform }: { platform: AppPlatform }) {
  const navigate = useNavigate()
  const { signInWithEmail, signUpWithEmail, requestMagicLink } = useAuth()
  const [mode, setMode] = useState<Mode>('password')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function goToHome() {
    if (platform === 'web') {
      window.location.assign('/')
      return
    }
    await navigate({ to: '/' })
  }

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
    await goToHome()
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)
    const result = await signUpWithEmail({ name, email, password })
    setSubmitting(false)
    if (!result.ok) {
      setError(result.message ?? 'Sign-up failed.')
      return
    }
    if (result.verificationRequired) {
      setNotice(result.message ?? 'Check your email to verify your account before signing in.')
      return
    }
    await goToHome()
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

  const handleSubmit =
    mode === 'password' ? handlePassword : mode === 'register' ? handleRegister : handleMagicLink

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 text-ink">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <header className="flex flex-col items-center gap-3 text-center">
          <Wordmark className="h-12 w-auto" />
          <h1 className="text-xl font-semibold tracking-tight">
            {mode === 'register' ? 'Create your Obiter account' : 'Sign in to Obiter'}
          </h1>
        </header>

        <Card>
          <div className="flex flex-col gap-4">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
              {mode === 'register' ? (
                <Input
                  label="Name"
                  type="text"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              ) : null}

              <Input
                label="Email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />

              {mode === 'password' || mode === 'register' ? (
                <Input
                  label="Password"
                  type="password"
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  required
                  minLength={mode === 'register' ? 8 : undefined}
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
                {mode === 'password'
                  ? 'Continue'
                  : mode === 'register'
                    ? 'Create account'
                    : 'Send sign-in link'}
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
              <span aria-hidden="true">·</span>
              <ModeButton active={mode === 'register'} onClick={() => setMode('register')}>
                Create account
              </ModeButton>
            </div>
          </div>
        </Card>

        <p className="text-center text-xs text-subtle">
          {mode === 'register'
            ? 'Creating an account provisions your own organisation.'
            : 'New here? Choose "Create account" above to self-register.'}
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
