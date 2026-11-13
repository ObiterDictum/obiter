import { Button, Input, Switch } from '@obiter/ui'
import { useState, type FormEvent } from 'react'
import { AuthForm } from './auth-layout'

export function SignInTwoFactorStep({
  onVerify,
  onRestart,
}: {
  onVerify: (input: {
    code: string
    backupCode: boolean
    trustDevice: boolean
  }) => Promise<{ ok: boolean; message?: string }>
  onRestart: () => void
}) {
  const [code, setCode] = useState('')
  const [backupCode, setBackupCode] = useState(false)
  const [trustDevice, setTrustDevice] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const trimmed = code.trim()
  const complete = backupCode ? trimmed.length > 0 : /^\d{6}$/.test(trimmed)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || !complete) return
    setError(null)
    setSubmitting(true)
    try {
      const result = await onVerify({ code: trimmed, backupCode, trustDevice })
      if (!result.ok) {
        setError(result.message ?? 'Could not verify your second factor.')
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not verify your second factor.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthForm onSubmit={handleSubmit}>
      <p className="text-meta text-muted">
        {backupCode
          ? 'Enter one of your backup codes to finish signing in.'
          : 'Enter the 6-digit code from your authenticator app to finish signing in.'}
      </p>
      <Input
        label={backupCode ? 'Backup code' : 'Authentication code'}
        type="text"
        inputMode={backupCode ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        required
        className="h-control-large"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        error={error ?? undefined}
      />
      <Switch
        label="Use a backup code"
        checked={backupCode}
        onCheckedChange={(checked) => {
          setBackupCode(checked)
          setCode('')
          setError(null)
        }}
      >
        Use a backup code
      </Switch>
      <Switch
        label="Trust this device for 30 days"
        checked={trustDevice}
        onCheckedChange={setTrustDevice}
      >
        Trust this device for 30 days
      </Switch>
      <Button
        type="submit"
        size="lg"
        loading={submitting}
        disabled={!complete || submitting}
        className="mt-1 w-full"
      >
        Verify and sign in
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={onRestart}
        className="w-full"
      >
        Start sign-in again
      </Button>
    </AuthForm>
  )
}
