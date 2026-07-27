import { useState } from 'react'
import { DownloadSimple } from '@phosphor-icons/react'
import type { OutputMode } from '@obiter/contracts'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@obiter/ui'
import { DegradedDetectionWarning } from './degraded-detection-warning'
import { useFinalizeRun } from './hooks'
import type { RedactionRun } from './types'

export function FinalizeDialog({ run }: { run: RedactionRun }) {
  const [open, setOpen] = useState(false)
  const [outputMode, setOutputMode] = useState<OutputMode>('redacted')
  const [unreviewedConfirmed, setUnreviewedConfirmed] = useState(false)
  const [degradedConfirmed, setDegradedConfirmed] = useState(false)
  const finalize = useFinalizeRun(run.id)
  const hasUnreviewed = run.summary.unreviewedCount > 0
  const isDegraded = run.detectionMode === 'heuristics+supplement'
  const close = () => {
    setOpen(false)
    setUnreviewedConfirmed(false)
    setDegradedConfirmed(false)
  }
  const submit = () => {
    if (
      (hasUnreviewed && !unreviewedConfirmed) ||
      (isDegraded && !degradedConfirmed)
    )
      return
    finalize.mutate(
      {
        outputMode,
        ...(isDegraded
          ? { degradedDetectionAcknowledged: degradedConfirmed }
          : {}),
      },
      { onSuccess: close },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => (nextOpen ? setOpen(true) : close())}
    >
      <Button
        variant="primary"
        onClick={() => setOpen(true)}
        iconStart={<DownloadSimple size={16} aria-hidden="true" />}
      >
        Finalize
      </Button>
      <DialogContent>
        <DialogTitle>Finalize redaction output</DialogTitle>
        <DialogDescription>
          Choose the output format. Pseudonymisation is keyed by exact text
          within each category, not entity identity.
        </DialogDescription>
        <div className="flex flex-col gap-3">
          {isDegraded ? <DegradedDetectionWarning /> : null}
          <label className="flex gap-2 text-sm text-ink">
            <input
              type="radio"
              checked={outputMode === 'redacted'}
              onChange={() => setOutputMode('redacted')}
            />{' '}
            <span>
              <strong>Redacted</strong>
              <br />
              <span className="text-muted">
                Replaces approved spans with [REDACTED].
              </span>
            </span>
          </label>
          <label className="flex gap-2 text-sm text-ink">
            <input
              type="radio"
              checked={outputMode === 'pseudonymised'}
              onChange={() => setOutputMode('pseudonymised')}
            />{' '}
            <span>
              <strong>Pseudonymised</strong>
              <br />
              <span className="text-muted">
                Uses consistent category tokens; re-identification requires
                token-map access.
              </span>
            </span>
          </label>
          {hasUnreviewed ? (
            <label className="rounded-md border border-warning p-3 text-sm text-ink">
              <input
                className="mr-2"
                type="checkbox"
                checked={unreviewedConfirmed}
                onChange={(event) =>
                  setUnreviewedConfirmed(event.target.checked)
                }
              />
              {run.summary.unreviewedCount} spans are unreviewed and will remain
              unchanged. I understand.
            </label>
          ) : null}
          {isDegraded ? (
            <label className="rounded-md border border-warning p-3 text-sm text-ink">
              <input
                className="mr-2"
                type="checkbox"
                checked={degradedConfirmed}
                onChange={(event) => setDegradedConfirmed(event.target.checked)}
              />
              I acknowledge that model detection did not run and have manually
              checked for names, addresses and dates of birth.
            </label>
          ) : null}
          {finalize.error ? (
            <p className="text-sm text-danger">{finalize.error.message}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button variant="secondary">Cancel</Button>} />
            <Button
              variant="primary"
              loading={finalize.isPending}
              disabled={
                (hasUnreviewed && !unreviewedConfirmed) ||
                (isDegraded && !degradedConfirmed)
              }
              onClick={submit}
            >
              Confirm finalize
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
