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
import { DetectionModeWarning } from './detection-mode-warning'
import { useFinalizeRun } from './hooks'
import type { RedactionRun } from './types'

export function FinalizeDialog({ run }: { run: RedactionRun }) {
  const [open, setOpen] = useState(false)
  const [outputMode, setOutputMode] = useState<OutputMode>('redacted')
  const [unreviewedConfirmed, setUnreviewedConfirmed] = useState(false)
  const [detectionConfirmed, setDetectionConfirmed] = useState(false)
  const finalize = useFinalizeRun(run.id)
  const hasUnreviewed = run.summary.unreviewedCount > 0
  const limitedDetectionMode =
    run.detectionMode === 'model+supplement' ? null : run.detectionMode
  const close = () => {
    setOpen(false)
    setUnreviewedConfirmed(false)
    setDetectionConfirmed(false)
  }
  const submit = () => {
    if (
      (hasUnreviewed && !unreviewedConfirmed) ||
      (limitedDetectionMode && !detectionConfirmed)
    )
      return
    finalize.mutate(
      {
        outputMode,
        ...(limitedDetectionMode === 'heuristics+supplement'
          ? { degradedDetectionAcknowledged: detectionConfirmed }
          : limitedDetectionMode === 'unknown'
            ? { unknownDetectionAcknowledged: detectionConfirmed }
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
          Choose how this document leaves Obiter. A secure redacted PDF is fixed
          and share-safe. A pseudonymised editable copy is for continued
          internal work and keeps its token map behind restricted, audited
          access. They are different confidentiality workflows, not two formats
          of the same output.
        </DialogDescription>
        <div className="flex flex-col gap-3">
          {limitedDetectionMode ? (
            <DetectionModeWarning
              detectionMode={limitedDetectionMode}
              role="alert"
            />
          ) : null}
          <fieldset className="flex flex-col gap-3">
            <legend className="sr-only">Output type</legend>
            <label className="flex gap-2 text-sm text-ink">
              <input
                type="radio"
                name="redaction-output-mode"
                checked={outputMode === 'redacted'}
                onChange={() => setOutputMode('redacted')}
              />{' '}
              <span>
                <strong>Secure redacted PDF</strong>
                <br />
                <span className="text-muted">
                  Removes accepted content and creates a fixed, share-safe PDF
                  with opaque black bars. The finalized PDF contains no
                  selectable source-text layer.
                </span>
              </span>
            </label>
            <label className="flex gap-2 text-sm text-ink">
              <input
                type="radio"
                name="redaction-output-mode"
                checked={outputMode === 'pseudonymised'}
                onChange={() => setOutputMode('pseudonymised')}
              />{' '}
              <span>
                <strong>Pseudonymised editable copy</strong>
                <br />
                <span className="text-muted">
                  Replaces accepted content with consistent category tokens for
                  continued internal work. Token-map access remains restricted
                  and audited.
                </span>
              </span>
            </label>
          </fieldset>
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
          {limitedDetectionMode ? (
            <label className="rounded-md border border-warning p-3 text-sm text-ink">
              <input
                className="mr-2"
                type="checkbox"
                checked={detectionConfirmed}
                onChange={(event) =>
                  setDetectionConfirmed(event.target.checked)
                }
              />
              {limitedDetectionMode === 'heuristics+supplement'
                ? 'I acknowledge that model detection did not run and have manually checked for names, addresses and dates of birth.'
                : 'I acknowledge that the detection mode was not recorded and have manually checked for names, addresses and dates of birth.'}
            </label>
          ) : null}
          {finalize.error ? (
            <p className="text-sm text-danger" role="alert">
              {finalize.error.message}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button variant="secondary">Cancel</Button>} />
            <Button
              variant="primary"
              loading={finalize.isPending}
              disabled={
                (hasUnreviewed && !unreviewedConfirmed) ||
                Boolean(limitedDetectionMode && !detectionConfirmed)
              }
              onClick={submit}
            >
              {outputMode === 'redacted'
                ? 'Create secure PDF'
                : 'Create pseudonymised copy'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
