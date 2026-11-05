import { Button, Input } from '@obiter/ui'
import { useState, type FormEvent } from 'react'
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  USER_NAME_MAX_LENGTH,
} from '@obiter/contracts'
import { useAuth } from '../auth'

function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH)
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  if (password.length > MAX_PASSWORD_LENGTH)
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`
  if (password !== confirm) return 'Passwords do not match.'
  return null
}

export function AccountSetupForm() {
  const { signUpWithEmail } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    const problem = passwordProblem(password, confirm)
    setError(problem)
    if (problem) return
    setSubmitting(true)
    try {
      const result = await signUpWithEmail({
        name: name.trim(),
        email: email.trim(),
        password,
        callbackURL: `${window.location.origin}/`,
      })
      if (!result.ok) {
        setError(result.message ?? 'Could not create your account.')
        return
      }
      setSentTo(email.trim())
    } catch {
      setError(
        'Could not create your account. Check your connection and try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (sentTo) {
    return (
      <div role="status" className="mt-3 flex flex-col gap-1">
        <h2 className="text-section text-ink">Check your inbox</h2>
        <p className="max-w-[42ch] text-body text-muted">
          We have sent a link to {sentTo}. Open it to confirm the address and
          finish setting up your account.
        </p>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="mt-3 flex w-full flex-col gap-5 self-stretch text-left"
    >
      <Input
        label="Name"
        type="text"
        autoComplete="name"
        required
        maxLength={USER_NAME_MAX_LENGTH}
        className="h-control-large"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Input
        label="Email you confirmed"
        type="email"
        autoComplete="email"
        required
        className="h-control-large"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <Input
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        maxLength={MAX_PASSWORD_LENGTH}
        className="h-control-large"
        value={password}
        helperText={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        onChange={(event) => setPassword(event.target.value)}
      />
      <Input
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        maxLength={MAX_PASSWORD_LENGTH}
        className="h-control-large"
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
      />
      {error ? (
        <p role="alert" className="text-meta text-danger">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        size="lg"
        loading={submitting}
        className="mt-1 w-full"
      >
        Create account
      </Button>
    </form>
  )
}
