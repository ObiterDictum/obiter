import { Button, Input } from '@obiter/ui'
import { useState, type FormEvent } from 'react'
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  ORGANISATION_NAME_MAX_LENGTH,
  parseOrganisationName,
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

export function AccountSetupForm({
  approvedEmail,
  register,
}: {
  approvedEmail?: string
  register?: (input: { name: string; password: string }) => Promise<void>
} = {}) {
  const { signUpWithEmail } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState(approvedEmail ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [choosingWorkspace, setChoosingWorkspace] = useState(false)
  const [organisationName, setOrganisationName] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    const problem = passwordProblem(password, confirm)
    setError(problem)
    if (problem) return
    if (!register) {
      setChoosingWorkspace(true)
      return
    }
    await submit()
  }

  async function submit(pendingOrganisationName?: string) {
    if (submitting) return
    setError(null)
    setSubmitting(true)
    try {
      if (register) {
        await register({ name: name.trim(), password })
        return
      }
      const result = await signUpWithEmail({
        name: name.trim(),
        email: email.trim(),
        password,
        pendingOrganisationName,
        callbackURL: `${window.location.origin}/`,
      })
      if (!result.ok) {
        setError(result.message ?? 'Could not create your account.')
        return
      }
      setSentTo(email.trim())
    } catch (error) {
      setError(
        register && error instanceof Error
          ? error.message
          : 'Could not create your account. Check your connection and try again.',
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

  if (choosingWorkspace) {
    return (
      <form
        className="mt-3 flex w-full flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          const parsed = parseOrganisationName(organisationName)
          if (parsed.ok) void submit(parsed.name)
          else setError(parsed.message)
        }}
      >
        <div>
          <h2 className="text-section text-ink">Create an organisation</h2>
          <p className="text-body text-muted">
            Name your organisation to set up a team workspace, or continue with
            a personal workspace.
          </p>
        </div>
        <Input
          label="Organisation name"
          autoComplete="organization"
          maxLength={ORGANISATION_NAME_MAX_LENGTH}
          value={organisationName}
          onChange={(event) => setOrganisationName(event.target.value)}
        />
        {error ? (
          <p role="alert" className="text-meta text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" disabled={submitting}>
          Create organisation
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={submitting}
          onClick={() => void submit()}
        >
          Continue as an individual
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={submitting}
          onClick={() => {
            setError(null)
            setChoosingWorkspace(false)
          }}
        >
          Back
        </Button>
      </form>
    )
  }

  const emailInput = (
    <Input
      label={register ? 'Invited email' : 'Email you confirmed'}
      readOnly={!!approvedEmail}
      type="email"
      autoComplete="email"
      required
      className="h-control-large"
      value={approvedEmail ?? email}
      onChange={(event) => setEmail(event.target.value)}
    />
  )

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="mt-3 flex w-full flex-col gap-5 self-stretch text-left"
    >
      {register ? emailInput : null}
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
      {register ? null : emailInput}
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
        {register ? 'Create account and join' : 'Continue'}
      </Button>
    </form>
  )
}
