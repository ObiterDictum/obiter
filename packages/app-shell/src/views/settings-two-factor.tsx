import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@obiter/ui'
import { useRef, useState, type FormEvent } from 'react'
import type { TwoFactorSetupResponse } from '@obiter/contracts/two-factor'
import { useCurrentUser } from '../current-user'
import {
  confirmTwoFactorEnrolment,
  disableTwoFactor,
  enableTwoFactor,
  regenerateTwoFactorBackupCodes,
  twoFactorQrDataUrl,
} from '../two-factor'
import { formatDate } from '../format'
import { BackupCodesPanel } from './settings-two-factor-backup-codes'
import { TwoFactorEnrolForm } from './settings-two-factor-enrol'
import {
  ErrorNotice,
  PasswordField,
  SavedNotice,
  SectionHeading,
} from './settings-fields'

type Step =
  | { kind: 'off' }
  | { kind: 'enable-password' }
  | { kind: 'enrol'; setup: TwoFactorSetupResponse; qr: string | null }
  | { kind: 'enrol-codes'; codes: string[] }
  | { kind: 'enabled' }
  | { kind: 'regen-password' }
  | { kind: 'regen-codes'; codes: string[] }
  | { kind: 'disable-password' }

export function TwoFactorSection() {
  const { data: me } = useCurrentUser()
  const queryClient = useQueryClient()
  const passwordRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>(() =>
    me.twoFactorEnabled === true ? { kind: 'enabled' } : { kind: 'off' },
  )
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const enabled = me.twoFactorEnabled === true

  async function refreshMe() {
    await queryClient.invalidateQueries({ queryKey: ['current-user'] })
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || !password) return
    setError(null)
    setSaved(false)
    setSubmitting(true)
    try {
      if (step.kind === 'enable-password') {
        const result = await enableTwoFactor(password)
        if (!result.ok || !result.data) {
          setError(result.message ?? 'Could not start setup. Try again.')
          return
        }
        const qr = await twoFactorQrDataUrl(result.data.totpURI).catch(
          () => null,
        )
        setPassword('')
        setStep({ kind: 'enrol', setup: result.data, qr })
        return
      }
      if (step.kind === 'regen-password') {
        const result = await regenerateTwoFactorBackupCodes(password)
        if (!result.ok || !result.data) {
          setError(result.message ?? 'Could not regenerate codes. Try again.')
          return
        }
        setPassword('')
        setSaved(true)
        setStep({ kind: 'regen-codes', codes: result.data.backupCodes })
        return
      }
      if (step.kind === 'disable-password') {
        const result = await disableTwoFactor(password)
        if (!result.ok) {
          setError(result.message ?? 'Could not turn off two-factor.')
          return
        }
        setPassword('')
        await refreshMe()
        setStep({ kind: 'off' })
      }
    } catch {
      setError('Could not complete the request. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleEnrolSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || code.trim().length === 0) return
    setError(null)
    setSubmitting(true)
    try {
      const result = await confirmTwoFactorEnrolment(code.trim())
      if (!result.ok) {
        setError(result.message ?? 'That code is not correct.')
        return
      }
      setCode('')
      if (step.kind === 'enrol') {
        setStep({ kind: 'enrol-codes', codes: step.setup.backupCodes })
      }
      await refreshMe()
    } catch {
      setError('Could not verify the code. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const passwordStep =
    step.kind === 'enable-password' ||
    step.kind === 'regen-password' ||
    step.kind === 'disable-password'

  return (
    <section
      className="flex flex-col gap-6"
      aria-label="Two-factor authentication"
    >
      <SectionHeading
        id="settings-two-factor-heading"
        level="h3"
        title="Two-factor authentication"
        description="Require a code from your authenticator app, or a backup code, when you sign in."
      />

      {enabled && step.kind === 'enabled' ? (
        <div className="flex max-w-[480px] flex-col gap-4">
          <p className="text-meta text-ink">
            Two-factor authentication is on
            {me.twoFactorEnabledAt
              ? `, enabled ${formatDate(me.twoFactorEnabledAt)}`
              : ''}
            .
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setError(null)
                setSaved(false)
                setStep({ kind: 'regen-password' })
              }}
            >
              Regenerate backup codes
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setError(null)
                setSaved(false)
                setStep({ kind: 'disable-password' })
              }}
            >
              Turn off
            </Button>
          </div>
          <SavedNotice message="Saved" show={saved} />
          {error ? <ErrorNotice message={error} /> : null}
        </div>
      ) : null}

      {step.kind === 'off' ? (
        <div className="flex max-w-[480px] flex-col gap-4">
          <p className="text-meta text-muted">
            Two-factor authentication is off. Turn it on to require a second
            step at sign-in.
          </p>
          <div>
            <Button
              type="button"
              onClick={() => {
                setError(null)
                setStep({ kind: 'enable-password' })
              }}
            >
              Set up
            </Button>
          </div>
        </div>
      ) : null}

      {passwordStep ? (
        <form
          className="flex max-w-[480px] flex-col gap-4"
          onSubmit={handlePasswordSubmit}
          noValidate
        >
          <PasswordField
            inputRef={passwordRef}
            label="Confirm your password"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
          />
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              loading={submitting}
              disabled={!password || submitting}
            >
              {step.kind === 'enable-password'
                ? 'Continue'
                : step.kind === 'regen-password'
                  ? 'Regenerate codes'
                  : 'Turn off two-factor'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setPassword('')
                setError(null)
                setStep(enabled ? { kind: 'enabled' } : { kind: 'off' })
              }}
            >
              Cancel
            </Button>
            <SavedNotice message="Saved" show={saved} />
          </div>
          {error ? <ErrorNotice message={error} /> : null}
        </form>
      ) : null}

      {step.kind === 'enrol' ? (
        <TwoFactorEnrolForm
          setup={step.setup}
          qr={step.qr}
          code={code}
          onCodeChange={setCode}
          onSubmit={handleEnrolSubmit}
          submitting={submitting}
          error={error}
          codeRef={codeRef}
        />
      ) : null}

      {step.kind === 'enrol-codes' || step.kind === 'regen-codes' ? (
        <div className="flex max-w-[480px] flex-col gap-4">
          <BackupCodesPanel codes={step.codes} />
          <div>
            <Button
              type="button"
              onClick={() => {
                setStep(enabled ? { kind: 'enabled' } : { kind: 'off' })
              }}
            >
              Done
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
