import type { FormEvent, RefObject } from 'react'
import { Button, Input } from '@obiter/ui'
import {
  parseTotpProvisioningUri,
  type TwoFactorSetupResponse,
} from '@obiter/contracts/two-factor'
import { ErrorNotice } from './settings-fields'

export function TwoFactorEnrolForm({
  setup,
  qr,
  code,
  onCodeChange,
  onSubmit,
  submitting,
  error,
  codeRef,
}: {
  setup: TwoFactorSetupResponse
  qr: string | null
  code: string
  onCodeChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  submitting: boolean
  error: string | null
  codeRef: RefObject<HTMLInputElement | null>
}) {
  const provisioning = parseTotpProvisioningUri(setup.totpURI)

  return (
    <form
      className="flex max-w-[480px] flex-col gap-4"
      onSubmit={onSubmit}
      noValidate
    >
      {qr ? (
        <img
          src={qr}
          alt="QR code for your authenticator app"
          className="size-48 rounded-md border border-line bg-raised"
        />
      ) : null}
      {provisioning ? (
        <div className="flex flex-col gap-1">
          <p className="text-meta text-ink">
            Cannot scan? Enter this key manually:
          </p>
          <p
            data-two-factor-secret
            className="break-all font-mono text-meta text-ink"
          >
            {provisioning.secret}
          </p>
        </div>
      ) : null}
      <Input
        ref={codeRef}
        label="Authentication code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        className="h-control-large"
        value={code}
        onChange={(event) => onCodeChange(event.target.value)}
      />
      <div className="flex items-center gap-3">
        <Button
          type="submit"
          loading={submitting}
          disabled={code.trim().length === 0 || submitting}
        >
          Confirm and turn on
        </Button>
      </div>
      {error ? <ErrorNotice message={error} /> : null}
    </form>
  )
}
